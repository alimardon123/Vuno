// Vuno — one agent turn.
//
// The bridge ADR-0006 always described and nothing implemented: work item →
// adapter → validated events on the spine, with what the run cost recorded
// against it.
//
// Three rules hold here:
//   - Nothing a model produces reaches the spine unvalidated. Everything goes
//     through `parseAgentOutput` inside the adapter, and what it refuses is
//     reported rather than dropped.
//   - An agent writes as itself. `actorMemberId` is the agent; when it acts on
//     someone's authority, `onBehalfOfMemberId` is them (ADR-0009).
//   - A claim an agent proposes is asserted, never born tested or falsified.
//     Only a measurement moves a claim there (ADR-0005).

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { assertClaim } from '@/lib/ledger/claims';
import { getAgentRow } from '@/lib/members';
import { resolveAdapter } from '@/lib/agents/registry';
import type { AgentContext, AgentManifest, ScopeType } from '@/lib/agents/types';
import type { AgentRun } from '@/lib/agents/adapters/run';

export interface TurnRequest {
  tenantId: string;
  orgId: string;
  memberId: string;
  scopeType: ScopeType;
  scopeId: string;
  projectId?: string;
  /** Why this agent was brought in — goes into the prompt. */
  reason?: string;
  triggerType?: string;
  /** Set when the agent is acting on a member's authority (ADR-0009). */
  onBehalfOfMemberId?: string;
  /** How much of the conversation to hand the model. */
  contextEvents?: number;
}

export interface TurnResult {
  eventIds: string[];
  claimIds: string[];
  /** What the boundary refused, so a turn that produced nothing can say why. */
  rejections: Array<{ at: string; reason: string }>;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  modelName: string;
  harnessName: string;
  summary: string;
}

export class NoHarness extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NoHarness';
  }
}

/** Run one turn. Throws NoHarness when nothing is configured to run this agent. */
export async function runAgentTurn(req: TurnRequest): Promise<TurnResult> {
  const agent = await getAgentRow(req.memberId);
  if (!agent) throw new Error(`${req.memberId} is not an agent in this org`);

  const manifest: AgentManifest = {
    id: agent.id,
    role: agent.role ?? 'agent',
    kind: agent.ownerMemberId ? 'personal_assistant' : 'independent',
    modelName: agent.modelName ?? '',
    harnessName: agent.harnessName ?? '',
    tools: agent.tools ?? [],
    permissions: agent.permissions ?? [],
  };

  const resolved = resolveAdapter(manifest);
  if (!resolved.ok) throw new NoHarness(`${agent.name}: ${resolved.reason}`);

  const [events, claims] = await Promise.all([
    db.event.findMany({
      where: { orgId: req.orgId, scopeType: req.scopeType, scopeId: req.scopeId },
      orderBy: { seq: 'desc' },
      take: req.contextEvents ?? 24,
    }),
    db.claim.findMany({
      where: req.projectId
        ? { orgId: req.orgId, scopeType: 'project', scopeId: req.projectId }
        : { orgId: req.orgId, scopeType: req.scopeType, scopeId: req.scopeId },
      select: { id: true, statement: true, status: true, scopeType: true, scopeId: true },
      take: 40,
    }),
  ]);

  const ctx: AgentContext = {
    scope: { scopeType: req.scopeType, scopeId: req.scopeId, projectId: req.projectId },
    events: events.reverse().map((e) => ({
      ...e,
      payload: safeParse(e.payload as string),
      createdAt: String(e.createdAt),
    })) as AgentContext['events'],
    claims: claims.map((c) => ({ ...c, status: c.status as AgentContext['claims'][number]['status'] })),
    trigger: {
      type: req.triggerType ?? 'mentioned',
      payload: { reason: req.reason },
    },
  };

  const adapter = resolved.adapter as { run?: (c: AgentContext) => Promise<AgentRun> };
  if (typeof adapter.run !== 'function') {
    throw new Error(`The ${manifest.harnessName} harness does not report what a run cost`);
  }
  const run = await adapter.run(ctx);

  // Everything the agent says, appended as itself, in one transaction.
  const spine = new EventSpine(req.tenantId, req.orgId);
  const appended = await spine.append(
    run.response.events.map((e) => ({
      ...e,
      actorType: 'member' as const,
      actorMemberId: agent.id,
      ...(req.onBehalfOfMemberId ? { onBehalfOfMemberId: req.onBehalfOfMemberId } : {}),
    })),
  );

  // Claims are asserted with the agent as provenance. A claim it proposed as
  // "tested" or "falsified" is downgraded rather than trusted: those statuses
  // are reached by a measurement, and the agent is not the one recording it.
  const claimIds: string[] = [];
  for (const claim of run.response.claims) {
    const { id } = await assertClaim({
      tenantId: req.tenantId,
      orgId: req.orgId,
      statement: claim.statement,
      scopeType: claim.scopeType,
      scopeId: claim.scopeId,
      memberId: agent.id,
      provenanceEventId: appended[0]?.id,
      ...(claim.status === 'uncertain' ? { status: 'uncertain' as const } : {}),
    });
    claimIds.push(id);
  }

  const said = appended.length;
  const proposed = claimIds.length;
  const summary =
    said === 0 && proposed === 0
      ? run.rejections.length > 0
        ? `${agent.name} produced nothing usable: ${run.rejections[0].reason}`
        : `${agent.name} had nothing to add`
      : `${agent.name}: ${said} event${said === 1 ? '' : 's'}` +
        (proposed > 0 ? `, ${proposed} claim${proposed === 1 ? '' : 's'}` : '');

  return {
    eventIds: appended.map((e) => e.id),
    claimIds,
    rejections: run.rejections.map((r) => ({ at: r.at, reason: r.reason })),
    ...run.usage,
    summary,
  };
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
