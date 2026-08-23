// Vuno — /api/trace GET endpoint
// Reconstructs the causal chain from a single user message event ID.
// Per the product vision: "traceable, falsifiable reasoning" — but right now
// the events render as a flat chat log. This endpoint walks forward through
// all events that reference the trigger message (directly via triggerEventId /
// evidenceEventId, or indirectly via memoryReferences / handoff chains) and
// returns them as a causal timeline.
//
// Per the "Simple" principle: one GET endpoint, one query parameter, one pass.
// Per the "Powerful" principle: makes the collaboration loop VISIBLE + AUDITABLE.
// Per the "Efficient" principle: reuses the existing event spine — no new table.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { EventRecord } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

// A trace node is an event + its causal relationship to the trigger message.
interface TraceNode {
  event: EventRecord;
  // How this event relates to the trigger message:
  //   'trigger'   — the user message itself
  //   'reaction'  — attention router woke an agent (triggerEventId = trigger)
  //   'learning'  — PA learned a fact (evidenceEventId = trigger)
  //   'proactive' — PA posted a proactive note (memoryReferences point to learning events)
  //   'delegation'— PA delegated to an expert (triggerEventId = trigger)
  //   'response'  — expert responded (same actor as delegation target, within time window)
  relation: 'trigger' | 'reaction' | 'learning' | 'proactive' | 'delegation' | 'response';
  // Human-readable explanation of the causal link
  causalExplanation: string;
}

interface TraceResponse {
  triggerEvent: EventRecord | null;
  nodes: TraceNode[];
  stats: {
    totalEvents: number;
    agentsInvolved: string[];
    eventTypes: string[];
    durationMs: number;
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const triggerEventId = url.searchParams.get('triggerEventId');
    if (!triggerEventId) {
      return NextResponse.json(
        { ok: false, error: 'triggerEventId required' },
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

    // Fetch ALL events for the org (no scope filter — the trace may span channels).
    // Per the "Performant" principle: we fetch once + filter in memory.
    // In production this would be paginated / indexed by triggerEventId.
    const allEvents = await db.event.findMany({
      where: { tenantId: org.tenantId, orgId: org.id },
      orderBy: { seq: 'asc' },
      take: 1000,
    });

    // Parse JSON payloads + convert dates
    const events: EventRecord[] = allEvents.map((e) => {
      let payload = e.payload;
      try {
        payload = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch {
        // keep raw string if parse fails
      }
      return {
        id: e.id,
        seq: e.seq,
        type: e.type as EventRecord['type'],
        payload: payload as unknown as EventRecord['payload'],
        tenantId: e.tenantId,
        orgId: e.orgId,
        actorType: e.actorType as EventRecord['actorType'],
        actorMemberId: e.actorMemberId ?? undefined,
        onBehalfOfMemberId: e.actorMemberId ?? undefined,
        scopeType: e.scopeType as EventRecord['scopeType'],
        scopeId: e.scopeId,
        visibility: e.visibility as EventRecord['visibility'],
        createdAt: e.createdAt.toISOString(),
      } as EventRecord;
    });

    // Find the trigger event
    const triggerIdx = events.findIndex((e) => e.id === triggerEventId);
    if (triggerIdx === -1) {
      return NextResponse.json(
        { ok: false, error: `Event ${triggerEventId} not found` },
        { status: 404 },
      );
    }
    const triggerEvent = events[triggerIdx]!;
    const triggerSeq = triggerEvent.seq;
    const triggerTime = new Date(triggerEvent.createdAt).getTime();

    // Collect trace nodes — events that are causally linked to the trigger.
    const nodes: TraceNode[] = [];
    const involvedAgentIds = new Set<string>();

    // The trigger itself
    nodes.push({
      event: triggerEvent,
      relation: 'trigger',
      causalExplanation: 'User posted this message',
    });
    if (triggerEvent.actorMemberId) involvedAgentIds.add(`user:${triggerEvent.actorMemberId}`);

    // Walk forward through all events AFTER the trigger, within a 30s time window
    // (the collaboration loop typically completes in ~5-10s).
    const TIME_WINDOW_MS = 30_000;
    for (let i = triggerIdx + 1; i < events.length; i++) {
      const e = events[i]!;
      const eTime = new Date(e.createdAt).getTime();
      if (eTime - triggerTime > TIME_WINDOW_MS) break; // outside the window
      if (e.seq <= triggerSeq) continue; // safety: only forward

      const p = e.payload as Record<string, unknown> | null;
      if (!p) continue;

      // Check direct provenance links to the trigger
      const directTriggerId = (p.triggerEventId as string | undefined) ?? (p.evidenceEventId as string | undefined);

      // AttentionWakeup — triggerEventId = trigger
      if (e.type === 'AttentionWakeup' && directTriggerId === triggerEventId) {
        const agentId = (p as { agentId?: string }).agentId;
        if (agentId) involvedAgentIds.add(`agent:${agentId}`);
        nodes.push({
          event: e,
          relation: 'reaction',
          causalExplanation: `${(p as { agentName?: string }).agentName ?? 'Agent'} noticed this message (topic: ${(p as { topic?: string }).topic ?? '?'})`,
        });
        continue;
      }

      // MemoryUpdated — evidenceEventId = trigger
      if (e.type === 'MemoryUpdated' && (p.evidenceEventId as string | undefined) === triggerEventId) {
        const agentId = (p as { agentId?: string }).agentId;
        if (agentId) involvedAgentIds.add(`agent:${agentId}`);
        nodes.push({
          event: e,
          relation: 'learning',
          causalExplanation: `${(p as { agentName?: string }).agentName ?? 'PA'} learned: ${(p as { factType?: string }).factType ?? '?'} → ${(p as { value?: string }).value ?? '?'}`,
        });
        continue;
      }

      // PaProactiveNote — references MemoryUpdated events that were triggered by this message.
      // Check if any memoryReference.memoryEventId points to a MemoryUpdated event
      // that was itself triggered by this triggerEventId.
      if (e.type === 'PaProactiveNote') {
        const refs = (p.memoryReferences as Array<{ memoryEventId?: string }>) ?? [];
        const linkedToTrigger = refs.some((ref) => {
          const memEvent = events.find((ev) => ev.id === ref.memoryEventId);
          if (!memEvent) return false;
          const memPayload = memEvent.payload as Record<string, unknown> | null;
          return (memPayload?.evidenceEventId as string | undefined) === triggerEventId;
        });
        if (linkedToTrigger) {
          const agentId = (p as { agentId?: string }).agentId;
          if (agentId) involvedAgentIds.add(`agent:${agentId}`);
          nodes.push({
            event: e,
            relation: 'proactive',
            causalExplanation: `${(p as { agentName?: string }).agentName ?? 'PA'} posted a proactive note referencing the learned facts`,
          });
          continue;
        }
      }

      // AgentHandoff — triggerEventId = trigger
      if (e.type === 'AgentHandoff' && directTriggerId === triggerEventId) {
        const toAgentId = (p as { toAgentId?: string }).toAgentId;
        const fromAgentId = (p as { fromAgentId?: string }).fromAgentId;
        if (toAgentId) involvedAgentIds.add(`agent:${toAgentId}`);
        if (fromAgentId) involvedAgentIds.add(`agent:${fromAgentId}`);
        nodes.push({
          event: e,
          relation: 'delegation',
          causalExplanation: `${(p as { fromAgentName?: string }).fromAgentName ?? 'Agent'} delegated to ${(p as { toAgentName?: string }).toAgentName ?? 'expert'}`,
        });

        // Find the expert's response — the next MessagePosted by toAgentId within 5s
        const handoffTime = eTime;
        const toAgentIdVal = (p as { toAgentId?: string }).toAgentId;
        for (let j = i + 1; j < events.length; j++) {
          const resp = events[j]!;
          const respTime = new Date(resp.createdAt).getTime();
          if (respTime - handoffTime > 5_000) break;
          if (resp.type === 'MessagePosted' && resp.actorMemberId === toAgentIdVal && resp.scopeType === e.scopeType && resp.scopeId === e.scopeId) {
            nodes.push({
              event: resp,
              relation: 'response',
              causalExplanation: `${(p as { toAgentName?: string }).toAgentName ?? 'Expert'} responded to the handoff`,
            });
            i = j; // skip past the response in the outer loop
            break;
          }
        }
        continue;
      }
    }

    // Sort nodes by seq (chronological)
    nodes.sort((a, b) => a.event.seq - b.event.seq);

    // Compute stats
    const agentIds = Array.from(involvedAgentIds)
      .filter((id) => id.startsWith('agent:'))
      .map((id) => id.replace('agent:', ''));
    const eventTypes = Array.from(new Set(nodes.map((n) => n.event.type)));
    const lastTime = nodes.length > 0 ? new Date(nodes[nodes.length - 1]!.event.createdAt).getTime() : triggerTime;
    const durationMs = lastTime - triggerTime;

    const response: TraceResponse = {
      triggerEvent,
      nodes,
      stats: {
        totalEvents: nodes.length,
        agentsInvolved: agentIds,
        eventTypes,
        durationMs,
      },
    };

    return NextResponse.json({ ok: true, ...response });
  } catch (err) {
    console.error('GET /api/trace failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
