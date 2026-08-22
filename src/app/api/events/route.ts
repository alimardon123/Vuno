// Vuno — /api/events (proxied to Rust substrate on port 3030)
// Per ADR-0001: Rust owns the event spine. Next.js API routes proxy to it
// for append + replay operations, then handle realtime broadcast via socket.io.
// Falls back to Prisma if the Rust service is unavailable (Functional principle).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
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
]);

interface PostBody {
  type: string;
  payload: Record<string, unknown>;
  scopeType?: string;
  scopeId?: string;
  channelId?: string;
  decisionId?: string;
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
      actorType: 'human',
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
    return NextResponse.json({ ok: true, event: created[0] });
  } catch (err) {
    console.error('POST /api/events failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
