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
import { reachOf, teamScopesFor, visibleTo } from '@/lib/events/visibility';
import { EventSpine } from '@/lib/events/spine';
import { assertClaim } from '@/lib/ledger/claims';
import { getAgentRow } from '@/lib/members';
import { resolveAdapter } from '@/lib/agents/registry';
import { BudgetExhausted, spendToday } from '@/lib/agents/budget';
import { availableTools, heldConnections, MAX_CALLS_PER_TURN, runToolCalls } from '@/lib/agents/tools';
import type { AgentContext, AgentManifest, AvailableTool, ScopeType, ToolOutcome } from '@/lib/agents/types';
import type { AgentRun } from '@/lib/agents/adapters/run';
import type { NewEventInput } from '@/lib/events/types';

/**
 * How many times a turn may go back to the model after running tools.
 *
 * Two is enough for "ask, read, answer" and for one correction after a call
 * that failed. Past that a model that keeps asking is not converging, and each
 * pass is another call somebody pays for.
 */
const MAX_TOOL_PASSES = 2;

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

  // Checked before the call, not after: a budget enforced on the way out has
  // already spent the money it was meant to stop.
  const spend = await spendToday(req.orgId);
  if (spend.exhausted) throw new BudgetExhausted(spend);

  // An agent reads under the same rule a person does. Without this, the one
  // member who could see every private thought in the org was whichever agent
  // happened to be answering — and it would then repeat them out loud.
  const reach = await reachOf({ id: agent.id, ownerMemberId: agent.ownerMemberId });
  const channel =
    req.scopeType === 'channel'
      ? await db.channel.findUnique({ where: { id: req.scopeId }, select: { teamId: true } })
      : null;

  const [events, claims, held] = await Promise.all([
    db.event.findMany({
      where: {
        orgId: req.orgId,
        scopeType: req.scopeType,
        scopeId: req.scopeId,
        ...visibleTo(reach, teamScopesFor(reach, [{ id: req.scopeId, teamId: channel?.teamId ?? null }])),
      },
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
    // What this agent has been trained on. Assigning a skill is a staffing
    // decision, so it changes what the agent is told rather than sitting in a
    // table nothing reads (docs/IA-NAVIGATION.md).
    db.memberSkill.findMany({
      where: { memberId: req.memberId },
      select: { skill: { select: { name: true, content: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // What this agent can reach outside the org. A connection it holds and is
  // never told about is a row in a table — the same failure a skill has, and
  // the reason both live in one Library.
  const connections = await heldConnections(req.memberId);
  const tools: AvailableTool[] = availableTools(connections);

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
    ...(tools.length > 0 ? { tools } : {}),
  };

  const adapter = resolved.adapter as {
    run?: (c: AgentContext) => Promise<AgentRun>;
    skills?: Array<{ name: string; content: string }>;
  };
  adapter.skills = held.map((h) => h.skill);
  if (typeof adapter.run !== 'function') {
    throw new Error(`The ${manifest.harnessName} harness does not report what a run cost`);
  }
  let run = await adapter.run(ctx);

  // The tool loop. An agent that asked for a call gets it made, sees the
  // result, and answers — bounded, because every pass is another model call
  // somebody pays for and a model that keeps asking would otherwise not stop.
  const toolEvents: NewEventInput[] = [];
  const outcomes: ToolOutcome[] = [];
  let calls = 0;

  for (let pass = 0; pass < MAX_TOOL_PASSES; pass++) {
    const asked = run.response.toolCalls ?? [];
    if (asked.length === 0) break;

    const remaining = MAX_CALLS_PER_TURN - calls;
    if (remaining <= 0) break;

    const ran = await runToolCalls(asked.slice(0, remaining), connections, {
      scopeType: req.scopeType,
      scopeId: req.scopeId,
    });
    calls += ran.outcomes.length;
    toolEvents.push(...ran.events);
    outcomes.push(...ran.outcomes);

    // The budget is checked again: the first check was before one model call,
    // and this is another one.
    const now = await spendToday(req.orgId);
    if (now.exhausted) throw new BudgetExhausted(now);

    const next = await adapter.run({ ...ctx, toolResults: outcomes });
    run = {
      ...next,
      // Cost accumulates across passes, so what the turn records is what the
      // turn spent rather than what its last pass spent.
      usage: {
        ...next.usage,
        tokensIn: run.usage.tokensIn + next.usage.tokensIn,
        tokensOut: run.usage.tokensOut + next.usage.tokensOut,
        costCents: run.usage.costCents + next.usage.costCents,
        durationMs: run.usage.durationMs + next.usage.durationMs,
      },
      rejections: [...run.rejections, ...next.rejections],
    };
  }

  // Everything the agent says, appended as itself, in one transaction.
  const spine = new EventSpine(req.tenantId, req.orgId);
  const appended = await spine.append(
    // The calls first, then what the agent said about them — the log reads in
    // the order things happened, and a claim citing a measurement sits after
    // the record of the measurement being taken.
    [...toolEvents, ...run.response.events].map((e) => ({
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
