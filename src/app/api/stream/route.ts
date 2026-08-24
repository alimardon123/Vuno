// Vuno — GET /api/stream?scopeId=<id>&afterSeq=<n>
//
// Server-sent events: what has been appended to one conversation since seq N.
//
// This replaces a socket.io service on its own port, which nothing in dev
// started and nothing in the rebuilt shell connected to — so
// `broadcastEventAppended` had been firing into a void on every message. It
// mattered more once agents started answering through the orchestrator: a
// reply that arrives a few seconds after you asked is invisible if the page
// only renders what it had at request time.
//
// SSE rather than sockets because the spine already solves the hard part. It is
// append-only with a monotonic `seq`, so "everything after N" is exact: no
// missed events across a reconnect, no duplicates, no dedupe table. A client
// that drops and comes back asks for the same thing again with a higher N.
//
// The cost is a poll per open conversation. At one query every 1.5s against an
// indexed range scan that is cheaper than running a second process, and it
// behaves identically in development and in production.

import { db } from '@/lib/db';
import { canRead, getConversation } from '@/lib/conversations';
import { viewerFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const POLL_MS = 1_500;
/** Long enough to be worth holding open, short enough that nothing leaks. */
const MAX_LIFETIME_MS = 5 * 60_000;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const scopeId = params.get('scopeId');
  if (!scopeId) {
    return new Response('scopeId is required', { status: 400 });
  }

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!org) return new Response('No organisation', { status: 409 });

  // A stream of a conversation is a read of it. Without this, subscribing was
  // a way around the access check on the page.
  const viewer = await viewerFromRequest(req);
  const conversation = await getConversation(org.id, scopeId, viewer?.id);
  if (!conversation || !canRead(conversation, viewer)) {
    return new Response('Not found', { status: 404 });
  }

  const after = Number(params.get('afterSeq'));
  let cursor = Number.isFinite(after) && after > 0 ? after : await latestSeq(org.id, scopeId);

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };

      // Tells the client where it is, so a reconnect resumes rather than replays.
      send('cursor', { seq: cursor });

      const timer = setInterval(() => {
        void (async () => {
          if (closed) return;
          if (Date.now() - startedAt > MAX_LIFETIME_MS) {
            // The client reconnects on its own; this bounds a connection that
            // would otherwise be held for as long as a tab stays open.
            send('bye', { reason: 'lifetime' });
            close();
            return;
          }

          try {
            const rows = await db.event.findMany({
              where: { orgId: org.id, scopeType: 'channel', scopeId, seq: { gt: cursor } },
              orderBy: { seq: 'asc' },
              take: 100,
              select: { seq: true, type: true, actorMemberId: true },
            });
            if (rows.length === 0) return;
            cursor = rows[rows.length - 1].seq;
            // What changed, not the content: the page re-renders from the
            // server, so there is one rendering path rather than a second
            // client-side copy of a conversation to drift from it.
            send('appended', { seq: cursor, count: rows.length });
          } catch {
            // A transient database error should not kill the stream; the next
            // tick asks again from the same cursor.
          }
        })();
      }, POLL_MS);

      req.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and friends buffer streamed responses without this.
      'x-accel-buffering': 'no',
    },
  });
}

async function latestSeq(orgId: string, scopeId: string): Promise<number> {
  const row = await db.event.findFirst({
    where: { orgId, scopeType: 'channel', scopeId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  return row?.seq ?? 0;
}
