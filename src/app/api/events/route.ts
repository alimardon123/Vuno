import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { projectChatMessages } from '@/lib/events/project';
import { broadcastEventAppended } from '@/lib/realtime/broadcast';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

// GET /api/events?scopeType=channel&scopeId=<id>&fromSeq=<n>&types=<t1,t2>
// Returns events in seq order for a scope. If no scope given, returns all.
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

  // find first tenant/org (v1 = single-tenant)
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
// Used by the typed composer for Objection, Evidence, Benchmark, Decision types
// (v1: simple append; real agent orchestration happens via /api/debate).
const ALLOWED_TYPES = new Set([
  'MessagePosted',
  'ObjectionRaised',
  'EvidenceAttached',
  'AlternativeProposed',
  'ExperimentRequested',
  'BenchmarkReported',
  'DecisionRecorded',
  'RiskFlagged',
]);

interface PostBody {
  type: string;
  payload: Record<string, unknown>;
  scopeType?: string;
  scopeId?: string;
  channelId?: string; // convenience: if provided, scope to channel
  decisionId?: string; // convenience: if provided, scope to decision
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

    const spine = new EventSpine(org.tenantId, org.id);
    const input: NewEventInput = {
      type: body.type as NewEventInput['type'],
      payload: body.payload as NewEventInput['payload'],
      actorType: 'human',
      scopeType: scopeType as NewEventInput['scopeType'],
      scopeId,
    };

    const created = await spine.append([input]);
    // Broadcast to the realtime service so connected clients get the event instantly
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
