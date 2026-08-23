// Vuno — /api/thoughts — the memory graph query layer
// Per the user's vision: "I would like at least independent agents to somehow
// see each other's thoughts too if possible."
//
// Queries AgentThought events from the event spine. Supports filtering by:
// - agentId (whose thoughts)
// - topic (what the thought is about)
// - thoughtType (observation/hypothesis/conclusion/question/doubt)
// - relatedEventId (thoughts linked to a specific event)
//
// Returns thoughts with their agent name + role resolved. Visibility-filtered
// (currently returns all org-visible thoughts; team/private filtering in a
// later slice).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { actorLookup } from '@/lib/members';
import { EventSpine } from '@/lib/events/spine';
import type { EventPayloadMap } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = {
  architect: 'Distributed Systems Architect',
  engineer: 'Software Engineer',
  security: 'Security Architect',
  perf: 'Performance Engineer',
  qa: 'QA Engineer',
  devils_advocate: "Devil's Advocate",
  verifier: 'Verifier',
  product: 'Product Lead',
  research: 'Researcher',
  hr: 'HR / Meta',
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const agentId = params.get('agentId');
  const topic = params.get('topic');
  const thoughtType = params.get('thoughtType');
  const relatedEventId = params.get('relatedEventId');
  const scopeType = params.get('scopeType') ?? 'channel';
  const scopeId = params.get('scopeId');

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) return NextResponse.json({ thoughts: [] });

  // Replay all AgentThought events for this org
  const spine = new EventSpine(org.tenantId, org.id);
  const allEvents = await spine.replay({
    scopeType: scopeType || undefined,
    scopeId: scopeId || undefined,
    types: ['AgentThought'],
    limit: 1000,
  });

  // Agent lookup for name/role resolution
  const agentById = await actorLookup(org.id);

  // Filter + map thoughts
  const thoughts = allEvents
    .filter((e) => {
      const p = e.payload as EventPayloadMap['AgentThought'];
      if (!p) return false;
      if (agentId && e.actorMemberId !== agentId) return false;
      if (topic && !p.topic.toLowerCase().includes(topic.toLowerCase())) return false;
      if (thoughtType && p.thoughtType !== thoughtType) return false;
      if (relatedEventId && p.relatedEventId !== relatedEventId) return false;
      return true;
    })
    .map((e) => {
      const p = e.payload as EventPayloadMap['AgentThought'];
      const agent = e.actorMemberId ? agentById.get(e.actorMemberId) : null;
      return {
        id: e.id,
        seq: e.seq,
        agentId: e.actorMemberId,
        agentName: agent?.name ?? 'Unknown',
        agentRole: agent?.role ?? '',
        agentRoleLabel: agent?.role ? ROLE_LABELS[agent.role] ?? agent.role : '',
        thoughtType: p.thoughtType,
        content: p.content,
        topic: p.topic,
        relatedEventId: p.relatedEventId ?? null,
        relatedThoughtId: p.relatedThoughtId ?? null,
        visibility: p.visibility,
        createdAt: e.createdAt,
      };
    });

  // Build bidirectional edge counts: for each thought, count how many other
  // thoughts reference it via relatedThoughtId. This gives the "N replies" badge
  // on parent thoughts — making the graph bidirectional.
  const replyCountMap = new Map<string, number>();
  for (const t of thoughts) {
    if (t.relatedThoughtId) {
      replyCountMap.set(t.relatedThoughtId, (replyCountMap.get(t.relatedThoughtId) ?? 0) + 1);
    }
  }
  // Enrich each thought with its reply count
  const enrichedThoughts = thoughts.map((t) => ({
    ...t,
    replyCount: replyCountMap.get(t.id) ?? 0,
  }));

  return NextResponse.json({ thoughts: enrichedThoughts, count: enrichedThoughts.length });
}
