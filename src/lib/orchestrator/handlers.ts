// Vuno — what the orchestrator actually does for each kind of work item.
//
// Every handler is a pure-ish step: it reads, appends events, and returns
// whether the objective should advance. It does not know about leases, retries
// or the loop — that is the runner's job.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { findAgentByRole, listAgentRows } from '@/lib/members';
import { NoHarness, runAgentTurn } from '@/lib/agents/turn';
import type { ScopeType } from '@/lib/events/types';
import { STAGES, type Stage } from './stages';
import type { LeasedItem } from './queue';

export interface HandlerResult {
  /** Advance the objective to the stage's declared `next`. */
  advance: boolean;
  /** Recorded on the work item, and useful when reading the queue back. */
  summary: string;
  /** The member that did the work, for the session record. */
  memberId?: string;
  /** What the run cost, when a model was involved. Recorded on the session. */
  usage?: {
    costCents?: number;
    tokensIn?: number;
    tokensOut?: number;
    modelName?: string;
    harnessName?: string;
  };
}

export type Handler = (item: LeasedItem) => Promise<HandlerResult>;

/**
 * Route a filed objective to the department that owns it.
 *
 * Deterministic: the objective names its department, or its success criteria
 * are matched against department names. No model is involved, because this is
 * exactly the tier-1 work the attention router's economics depend on keeping
 * free (vision doc §3, Layer 2).
 */
const routeObjective: Handler = async (item) => {
  const objective = await db.objective.findUnique({ where: { id: item.subjectId } });
  if (!objective) throw new Error(`Objective ${item.subjectId} not found`);

  const departments = await db.department.findMany({ where: { orgId: item.orgId } });
  const stated = objective.owningDepartment?.toLowerCase();
  const haystack = `${objective.title} ${objective.successCriteria}`.toLowerCase();

  const chosen =
    departments.find((d) => stated && d.name.toLowerCase() === stated) ??
    departments.find((d) => haystack.includes(d.name.toLowerCase())) ??
    departments.find((d) => d.name === 'Product') ??
    departments[0];

  if (!chosen) throw new Error('No departments exist to route to');

  await db.objective.update({
    where: { id: objective.id },
    data: { owningDepartment: chosen.name, status: 'active' },
  });

  const spine = new EventSpine(item.tenantId, item.orgId);
  await spine.append([
    {
      type: 'RoleAssigned',
      actorType: 'system',
      scopeType: 'objective',
      scopeId: objective.id,
      payload: {
        memberId: 'system',
        memberName: 'Orchestrator',
        role: 'owning_department',
        reason: `Routed to ${chosen.name}`,
        objectiveId: objective.id,
      },
    },
  ]);

  return { advance: true, summary: `Routed to ${chosen.name}` };
};

/** Assemble the working group: the teams in the owning department, plus Research. */
const assembleWorkingGroup: Handler = async (item) => {
  const objective = await db.objective.findUnique({ where: { id: item.subjectId } });
  if (!objective) throw new Error(`Objective ${item.subjectId} not found`);

  const roster = await listAgentRows(item.orgId);
  const lead = roster.find((a) => a.role === 'product') ?? roster[0];
  const researcher = await findAgentByRole(item.orgId, 'research');

  const group = [lead, researcher].filter(Boolean) as typeof roster;
  if (group.length === 0) throw new Error('No members available to form a working group');

  const spine = new EventSpine(item.tenantId, item.orgId);
  await spine.append(
    group.map((m) => ({
      type: 'RoleAssigned' as const,
      actorType: 'system' as const,
      scopeType: 'objective' as const,
      scopeId: objective.id,
      payload: {
        memberId: m.id,
        memberName: m.name,
        role: m.role,
        reason: `Working group for "${objective.title}"`,
        objectiveId: objective.id,
      },
    })),
  );

  return {
    advance: true,
    summary: `Working group: ${group.map((m) => m.name).join(', ')}`,
    memberId: lead?.id,
  };
};

/**
 * Interrogate the objective — what is ambiguous, what already exists.
 *
 * Ambiguity detection is deterministic: an objective whose success criteria
 * carry no number cannot be evaluated by a gate later, and the workflow doc
 * says such an objective is bounced back rather than silently drifting.
 */
const interrogateObjective: Handler = async (item) => {
  const objective = await db.objective.findUnique({ where: { id: item.subjectId } });
  if (!objective) throw new Error(`Objective ${item.subjectId} not found`);

  const role = (item.input as { role?: string }).role ?? 'product';
  const member = await findAgentByRole(item.orgId, role);
  const spine = new EventSpine(item.tenantId, item.orgId);

  const hasMeasurableCriteria = /\d/.test(objective.successCriteria);
  const statements: string[] = [];

  if (role === 'product') {
    statements.push(
      hasMeasurableCriteria
        ? `Success criteria are measurable: ${objective.successCriteria}`
        : `Success criteria carry no measurable threshold, so no gate can evaluate them: "${objective.successCriteria}"`,
    );
  } else {
    statements.push(`Prior art review requested for: ${objective.title}`);
  }

  await spine.append(
    statements.map((statement, i) => ({
      type: 'RequirementStated' as const,
      actorType: 'member' as const,
      actorMemberId: member?.id,
      scopeType: 'objective' as const,
      scopeId: objective.id,
      payload: {
        requirementId: `req-${objective.id}-${role}-${i}`,
        text: statement,
        objectiveId: objective.id,
      },
    })),
  );

  for (const statement of statements) {
    await db.claim.create({
      data: {
        tenantId: item.tenantId,
        orgId: item.orgId,
        statement,
        // Asserted, not believed: nothing has tested it yet. Status moves only
        // when evidence arrives (ADR-0005).
        status: hasMeasurableCriteria ? 'asserted' : 'uncertain',
        scopeType: 'objective',
        scopeId: objective.id,
        provenanceEventId: 'orchestrator',
        provenanceActorType: 'member',
        provenanceMemberId: member?.id ?? null,
        updatedAt: new Date(),
      },
    });
  }

  return {
    advance: role === 'research', // the last of the pair advances the stage
    summary: `${role} interrogation complete`,
    memberId: member?.id,
  };
};

/**
 * One agent turn: the adapter runs, and what it returns lands on the spine.
 *
 * This is what makes an @mention real. It was previously served by the
 * attention router, which matched substrings and posted hand-written replies —
 * so an agent "answered" without a model behind it and without any record of
 * what answering cost.
 *
 * With no harness configured this fails with the reason, which is the honest
 * outcome: the item lands in Activity under "Work that failed" saying which
 * variable to set. It is not retried, because retrying a missing API key just
 * burns the attempt budget.
 */
const agentTurn: Handler = async (item) => {
  const input = item.input as {
    memberId?: string;
    scopeType?: string;
    scopeId?: string;
    projectId?: string;
    reason?: string;
    onBehalfOfMemberId?: string;
  };

  const memberId = input.memberId ?? item.assigneeId;
  if (!memberId) throw new Error('An agent turn needs a member to run it');
  if (!input.scopeId) throw new Error('An agent turn needs somewhere to act');

  try {
    const result = await runAgentTurn({
      tenantId: item.tenantId,
      orgId: item.orgId,
      memberId,
      scopeType: (input.scopeType ?? 'channel') as ScopeType,
      scopeId: input.scopeId,
      projectId: input.projectId,
      reason: input.reason,
      onBehalfOfMemberId: input.onBehalfOfMemberId,
      triggerType: item.kind,
    });

    return {
      advance: false,
      summary: result.summary,
      memberId,
      usage: {
        costCents: result.costCents,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        modelName: result.modelName,
        harnessName: result.harnessName,
      },
    };
  } catch (err) {
    if (err instanceof NoHarness) {
      // Rethrown as a plain error so the runner records it and stops retrying —
      // no number of attempts will conjure a key.
      throw Object.assign(new Error(err.message), { permanent: true });
    }
    throw err;
  }
};

/** A stage whose handler is not written yet parks the objective rather than failing it. */
const notImplemented: Handler = async (item) => ({
  advance: false,
  summary: `No handler for "${item.kind}" yet — objective parked at this stage.`,
});

export const HANDLERS: Record<string, Handler> = {
  route_objective: routeObjective,
  assemble_working_group: assembleWorkingGroup,
  interrogate_objective: interrogateObjective,
  agent_turn: agentTurn,
};

export function handlerFor(kind: string): Handler {
  return HANDLERS[kind] ?? notImplemented;
}

/** The stage an objective moves to when the work for its current stage completes. */
export function nextStage(current: Stage): Stage | null {
  return STAGES[current]?.next ?? null;
}
