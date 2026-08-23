// Vuno — /api/events (proxied to Rust substrate on port 3030)
// Per ADR-0001: Rust owns the event spine. Next.js API routes proxy to it
// for append + replay operations, then handle realtime broadcast via socket.io.
// Falls back to Prisma if the Rust service is unavailable (Functional principle).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOrgOwner } from '@/lib/members';
import { originFrom } from '@/lib/origin';
import { EventSpine } from '@/lib/events/spine';
import { projectChatMessages } from '@/lib/events/project';
import { broadcastEventAppended } from '@/lib/realtime/broadcast';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const RUST_SUBSTRATE_URL = 'http://localhost:3030';

// Helper: check if the Rust substrate is available
async function isRustAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${RUST_SUBSTRATE_URL}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

// GET /api/events?scopeType=channel&scopeId=<id>&fromSeq=<n>&types=<t1,t2>
// Proxied to Rust (GET /events/replay). Falls back to Prisma if Rust is down.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const scopeType = params.get('scopeType') ?? undefined;
  const scopeId = params.get('scopeId') ?? undefined;
  const fromSeqRaw = params.get('fromSeq');
  const fromSeq = fromSeqRaw ? Number(fromSeqRaw) : undefined;
  const typesRaw = params.get('types');
  const types = typesRaw ? (typesRaw.split(',') as never[]) : undefined;
  const project = params.get('project') === 'true';

  // Try Rust substrate first
  if (await isRustAvailable()) {
    try {
      const rustUrl = new URL(`${RUST_SUBSTRATE_URL}/events/replay`);
      if (scopeType) rustUrl.searchParams.set('scope_type', scopeType);
      if (scopeId) rustUrl.searchParams.set('scope_id', scopeId);
      rustUrl.searchParams.set('limit', '500');

      const rustRes = await fetch(rustUrl.toString());
      if (rustRes.ok) {
        const rustData = await rustRes.json() as { events: unknown[] };
        // Convert created_at from integer (SQLite ms epoch) to ISO string
        const events = (rustData.events as Array<Record<string, unknown>>).map((e) => ({
          ...e,
          createdAt: typeof e.createdAt === 'number'
            ? new Date(e.createdAt).toISOString()
            : e.createdAt,
        }));

        if (project) {
          return NextResponse.json({ events, chatMessages: projectChatMessages(events as never) });
        }
        return NextResponse.json({ events });
      }
    } catch (err) {
      console.warn('[events] Rust replay failed, falling back to Prisma:', err);
    }
  }

  // Fallback: Prisma
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) {
    return NextResponse.json({ events: [], chatMessages: [] });
  }

  const spine = new EventSpine(org.tenantId, org.id);
  const events = await spine.replay({ scopeType, scopeId, fromSeq, types, limit: 500 });

  if (project) {
    return NextResponse.json({ events, chatMessages: projectChatMessages(events) });
  }
  return NextResponse.json({ events });
}

// POST /api/events — append a single typed event to the spine.
// Proxied to Rust (POST /events). Falls back to Prisma if Rust is down.
// After append, broadcasts via socket.io for real-time UI update.
const ALLOWED_TYPES = new Set([
  'MessagePosted',
  'ObjectionRaised',
  'EvidenceAttached',
  'AlternativeProposed',
  'ExperimentRequested',
  'BenchmarkReported',
  'DecisionRecorded',
  'RiskFlagged',
  'AgentThought',
  'SharedItem',
  'ReactionAdded',
  'ThreadReplyPosted',
  'PreemptIssued',
  'AttentionWakeup',
  'MemoryUpdated',
  'PaProactiveNote',
  'AgentHandoff',
]);

interface PostBody {
  type: string;
  payload: Record<string, unknown>;
  scopeType?: string;
  scopeId?: string;
  channelId?: string;
  decisionId?: string;
  useRealLLM?: boolean; // forwarded to attention-router + memory-evolution triggers
}

// Async trigger: after a user posts a MessagePosted in a channel, fire the
// attention router in the background. This is the "magic moment" — agents
// auto-wake if the message matches their domain of expertise.
// Per the "Performant" principle: fire-and-forget, never block the response.
function triggerAttentionRouter(origin: string, eventId: string, body: string | undefined, channelId: string, useRealLLM?: boolean): void {
  if (!body) return;
  // Fire-and-forget — don't await, don't block the response
  void fetch(`${origin}/api/attention-router`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageEventId: eventId, body, channelId, useRealLLM }),
  }).catch((err) => {
    // Silent failure — attention router is best-effort, never blocks user
    console.warn('[events] attention router trigger failed:', err);
  });
}

// Async trigger: after a human posts a MessagePosted, fire the memory evolution
// route. The PA (Bob) silently extracts learned facts (interests, focus areas,
// sentiment) from the message and updates his model of the owner.
// Per the "Powerful" principle: the PA visibly learns from the owner's behavior.
// Per the "Performant" principle: fire-and-forget, never blocks the response.
function triggerMemoryEvolution(
  origin: string,
  eventId: string,
  body: string | undefined,
  channelId: string,
  ownerUserId: string,
  useRealLLM?: boolean,
): void {
  if (!body) return;
  // Fire-and-forget — don't await, don't block the response
  void fetch(`${origin}/api/memory-evolution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageEventId: eventId, body, channelId, ownerUserId, useRealLLM }),
  }).catch((err) => {
    // Silent failure — memory evolution is best-effort, never blocks user
    console.warn('[events] memory evolution trigger failed:', err);
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (!body || !body.type || !body.payload) {
      return NextResponse.json({ ok: false, error: 'Missing type or payload' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(body.type)) {
      return NextResponse.json(
        { ok: false, error: `Type ${body.type} not allowed via this endpoint. Use /api/debate for orchestrated flows.` },
        { status: 400 },
      );
    }

    const org = await db.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, id: true },
    });
    if (!org) {
      return NextResponse.json({ ok: false, error: 'No organization found' }, { status: 400 });
    }

    // Resolve the org owner (the human who posts messages — Kai in v1).
    // The PA's memory evolution needs the owner's id to find the right PA.
    const ownerUser = await getOrgOwner(org.id);

    // Determine scope
    let scopeType = body.scopeType;
    let scopeId = body.scopeId;
    if (!scopeType || !scopeId) {
      if (body.channelId) {
        scopeType = 'channel';
        scopeId = body.channelId;
      } else if (body.decisionId) {
        scopeType = 'decision';
        scopeId = body.decisionId;
      } else {
        return NextResponse.json(
          { ok: false, error: 'Must provide scopeType+scopeId, channelId, or decisionId' },
          { status: 400 },
        );
      }
    }

    const input: NewEventInput = {
      type: body.type as NewEventInput['type'],
      payload: body.payload as NewEventInput['payload'],
      actorType: 'member',
      scopeType: scopeType as NewEventInput['scopeType'],
      scopeId,
    };

    // Try Rust substrate first
    if (await isRustAvailable()) {
      try {
        const rustRes = await fetch(`${RUST_SUBSTRATE_URL}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: [input] }),
        });
        if (rustRes.ok) {
          const rustData = await rustRes.json() as { events: Array<Record<string, unknown>> };
          const created = rustData.events[0];
          if (created) {
            // Convert created_at from integer to ISO string for the frontend
            const event = {
              ...created,
              createdAt: typeof created.createdAt === 'number'
                ? new Date(created.createdAt).toISOString()
                : created.createdAt,
            };
            // Broadcast via socket.io for real-time UI update
            void broadcastEventAppended({
              channelId: scopeType === 'channel' ? scopeId : undefined,
              scopeType,
              scopeId,
              event,
            });
            // Attention router — async fire-and-forget. Wakes agents if the
            // message matches their domain of expertise.
            if (body.type === 'MessagePosted' && scopeType === 'channel') {
              const bodyText = (body.payload as { body?: string }).body;
              const eventId = (event as { id?: unknown }).id;
              if (typeof eventId === 'string' && typeof bodyText === 'string') {
                triggerAttentionRouter(originFrom(req), eventId, bodyText, scopeId, body.useRealLLM);
                // Memory evolution — PA silently learns from the owner's messages.
                // Fires alongside the attention router (react + learn in parallel).
                if (ownerUser) {
                  triggerMemoryEvolution(originFrom(req), eventId, bodyText, scopeId, ownerUser.id, body.useRealLLM);
                }
              }
            }
            return NextResponse.json({ ok: true, event });
          }
        }
      } catch (err) {
        console.warn('[events] Rust append failed, falling back to Prisma:', err);
      }
    }

    // Fallback: Prisma
    const spine = new EventSpine(org.tenantId, org.id);
    const created = await spine.append([input]);
    void broadcastEventAppended({
      channelId: scopeType === 'channel' ? scopeId : undefined,
      scopeType,
      scopeId,
      event: created[0],
    });
    // Attention router — async fire-and-forget (Prisma path)
    if (body.type === 'MessagePosted' && scopeType === 'channel') {
      const bodyText = (body.payload as { body?: string }).body;
      if (typeof created[0]?.id === 'string' && typeof bodyText === 'string') {
        triggerAttentionRouter(originFrom(req), created[0].id, bodyText, scopeId, body.useRealLLM);
        // Memory evolution — PA silently learns (Prisma path)
        if (ownerUser) {
          triggerMemoryEvolution(originFrom(req), created[0].id, bodyText, scopeId, ownerUser.id, body.useRealLLM);
        }
      }
    }
    return NextResponse.json({ ok: true, event: created[0] });
  } catch (err) {
    console.error('POST /api/events failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
