// Vuno — /api/events
//
// Read the spine, and append one typed event to it.
//
// This route used to proxy to a Rust service on port 3030 and fall back to
// Prisma when it was down. Nothing starts that service, and if it ever did
// there would be two processes assigning `seq` on the same log — ADR-0008 says
// there is exactly one writer, and a spine with two is a spine whose order
// cannot be trusted. The proxy is gone; `EventSpine` is the writer.
//
// It also accepted `AttentionWakeup`, `MemoryUpdated`, `PaProactiveNote` and
// `AgentHandoff` from an unauthenticated POST, and wrote every event with
// `actorType: 'member'` and no member — the same unattributed-event bug that
// made a message you typed render as "Unknown". Both fixed here.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getMember, getOrgOwner } from '@/lib/members';
import { EventSpine } from '@/lib/events/spine';
import { projectChatMessages } from '@/lib/events/project';
import { broadcastEventAppended } from '@/lib/realtime/broadcast';
import type { EventType, NewEventInput, ScopeType } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

// What a person or an integration may state directly. Everything an agent run
// produces goes through the orchestrator, which records who ran it and what it
// cost; everything the ledger holds goes through /api/claims, which enforces
// the transition table. Neither is reachable from here by design.
const ALLOWED_TYPES = [
  'MessagePosted',
  'ThreadReplyPosted',
  'ObjectionRaised',
  'EvidenceAttached',
  'AlternativeProposed',
  'ExperimentRequested',
  'BenchmarkReported',
  'DecisionRecorded',
  'RiskFlagged',
  'SharedItem',
  'ReactionAdded',
] as const;

const postSchema = z
  .object({
    type: z.enum(ALLOWED_TYPES),
    payload: z.record(z.string(), z.unknown()),
    scopeType: z.enum(['channel', 'decision', 'project', 'objective', 'team', 'org', 'tenant']).optional(),
    scopeId: z.string().min(1).optional(),
    channelId: z.string().min(1).optional(),
    decisionId: z.string().min(1).optional(),
    actorMemberId: z.string().min(1).optional(),
    onBehalfOfMemberId: z.string().min(1).optional(),
  })
  .refine((b) => Boolean((b.scopeType && b.scopeId) || b.channelId || b.decisionId), {
    message: 'Provide scopeType and scopeId, or channelId, or decisionId.',
  });

// GET /api/events?scopeType=channel&scopeId=<id>&fromSeq=<n>&types=<t1,t2>&project=true
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) return NextResponse.json({ events: [], chatMessages: [] });

  const fromSeqRaw = params.get('fromSeq');
  const fromSeq = fromSeqRaw !== null && Number.isFinite(Number(fromSeqRaw)) ? Number(fromSeqRaw) : undefined;
  const typesRaw = params.get('types');
  const types = typesRaw ? (typesRaw.split(',').filter(Boolean) as EventType[]) : undefined;

  const spine = new EventSpine(org.tenantId, org.id);
  const events = await spine.replay({
    scopeType: params.get('scopeType') ?? undefined,
    scopeId: params.get('scopeId') ?? undefined,
    fromSeq,
    types,
    limit: 500,
  });

  if (params.get('project') === 'true') {
    return NextResponse.json({ events, chatMessages: projectChatMessages(events) });
  }
  return NextResponse.json({ events });
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof postSchema>;
  try {
    parsed = postSchema.parse((await req.json()) as unknown);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof z.ZodError
            ? e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
            : 'Invalid body',
        allowedTypes: ALLOWED_TYPES,
      },
      { status: 400 },
    );
  }

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) {
    return NextResponse.json(
      { ok: false, error: 'No organisation found. Seed the database first.' },
      { status: 409 },
    );
  }

  // Every event names who made it. An unattributed one is a hole in the record
  // the ledger reads from.
  const actor = parsed.actorMemberId ? await getMember(parsed.actorMemberId) : await getOrgOwner(org.id);
  if (!actor) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.actorMemberId
          ? 'Unknown member for this org.'
          : 'No org owner to attribute this event to. Seed the database first.',
      },
      { status: 400 },
    );
  }

  const scopeType = (parsed.scopeType ?? (parsed.channelId ? 'channel' : 'decision')) as ScopeType;
  const scopeId = parsed.scopeId ?? parsed.channelId ?? parsed.decisionId!;

  if (scopeType === 'channel') {
    const channel = await db.channel.findFirst({
      where: { id: scopeId, orgId: org.id },
      select: { id: true },
    });
    if (!channel) {
      return NextResponse.json({ ok: false, error: 'Unknown channel for this org.' }, { status: 400 });
    }
  }

  const spine = new EventSpine(org.tenantId, org.id);
  const [created] = await spine.append([
    {
      type: parsed.type,
      payload: parsed.payload,
      actorType: 'member',
      actorMemberId: actor.id,
      onBehalfOfMemberId: parsed.onBehalfOfMemberId,
      scopeType,
      scopeId,
    } as NewEventInput,
  ]);

  void broadcastEventAppended({
    channelId: scopeType === 'channel' ? scopeId : undefined,
    scopeType,
    scopeId,
    event: created,
  });

  return NextResponse.json({ ok: true, event: created });
}
