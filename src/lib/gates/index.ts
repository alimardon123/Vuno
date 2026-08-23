// Vuno — the gate engine (ADR-0007 §C)
//
// A gate is "a declarative policy evaluated as a query over the ledger" in the
// vision doc. In the code it was free text — `policy` held the sentence "no open
// RiskFlag of severity >= high" and the state was set by four hardcoded
// `db.gate.update` calls inside the debate route. Nothing evaluated anything, so
// a gate could not block something it had not been told to block.
//
// Here the policy is a predicate, evaluating it is a query, and a blocked gate
// can name the rows that blocked it.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { ClaimStatus } from '@/lib/events/types';

// ─── The predicate language ──────────────────────────────────────────────────
// Deliberately small. Two subjects and three combinators cover every gate the
// product describes; anything more is speculation until a gate needs it.

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface ClaimQuery {
  subject: 'claim';
  status?: ClaimStatus[];
  /** Restrict to the gate's own project, or search the whole org. */
  scope?: 'project' | 'org';
  statementContains?: string;
}

export interface RiskQuery {
  subject: 'risk';
  severityAtLeast?: Severity;
  scope?: 'project' | 'org';
}

export type Query = ClaimQuery | RiskQuery;

export type Policy =
  /** Passes when the query matches nothing. */
  | { none: Query }
  /** Passes when the query matches at least one row. */
  | { some: Query }
  /** Passes when every sub-policy passes. */
  | { all: Policy[] };

const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

export interface GateEvaluation {
  passed: boolean;
  /** Why, in a sentence a person can act on. */
  reason: string;
  /** What satisfied the query — the rows that blocked it. */
  evidence: Array<{ kind: 'claim' | 'risk'; id: string; label: string }>;
}

/** The policy in prose, derived rather than stored, so it cannot drift. */
export function describePolicy(policy: Policy): string {
  if ('all' in policy) return policy.all.map(describePolicy).join(' and ');
  const q = 'none' in policy ? policy.none : policy.some;
  const negated = 'none' in policy;
  const scope = q.scope === 'org' ? 'anywhere in the org' : 'on this project';

  if (q.subject === 'claim') {
    const statuses = q.status?.length ? q.status.join(' or ') : 'any';
    const about = q.statementContains ? ` mentioning "${q.statementContains}"` : '';
    return `${negated ? 'no' : 'at least one'} ${statuses} claim${about} ${scope}`;
  }
  const sev = q.severityAtLeast ? `${q.severityAtLeast}-or-worse ` : '';
  return `${negated ? 'no' : 'at least one'} open ${sev}risk ${scope}`;
}

async function runQuery(
  q: Query,
  ctx: { orgId: string; projectId: string },
): Promise<GateEvaluation['evidence']> {
  if (q.subject === 'claim') {
    const claims = await db.claim.findMany({
      where: {
        orgId: ctx.orgId,
        ...(q.status?.length ? { status: { in: q.status } } : {}),
        ...(q.scope === 'org' ? {} : { scopeType: 'project', scopeId: ctx.projectId }),
        ...(q.statementContains ? { statement: { contains: q.statementContains } } : {}),
      },
      select: { id: true, statement: true, status: true },
      take: 50,
    });
    return claims.map((c) => ({
      kind: 'claim' as const,
      id: c.id,
      label: `${c.status}: ${c.statement}`,
    }));
  }

  // Risks live on the event spine as RiskFlagged. v1 treats every flagged risk
  // as open, which is the conservative reading: a gate that blocks when it
  // should not is recoverable; one that opens when it should not is not.
  const events = await db.event.findMany({
    where: {
      orgId: ctx.orgId,
      type: 'RiskFlagged',
      ...(q.scope === 'org' ? {} : { scopeType: 'project', scopeId: ctx.projectId }),
    },
    orderBy: { seq: 'asc' },
    select: { id: true, payload: true },
  });

  const floor = q.severityAtLeast ? SEVERITY_ORDER.indexOf(q.severityAtLeast) : 0;
  const out: GateEvaluation['evidence'] = [];
  for (const e of events) {
    try {
      const p = JSON.parse(e.payload as string) as { severity?: Severity; description?: string };
      const rank = p.severity ? SEVERITY_ORDER.indexOf(p.severity) : -1;
      if (rank < floor) continue;
      out.push({ kind: 'risk', id: e.id, label: `${p.severity}: ${p.description ?? 'risk flagged'}` });
    } catch {
      continue;
    }
  }
  return out;
}

async function evaluatePolicy(
  policy: Policy,
  ctx: { orgId: string; projectId: string },
): Promise<GateEvaluation> {
  if ('all' in policy) {
    const results = await Promise.all(policy.all.map((p) => evaluatePolicy(p, ctx)));
    const failed = results.filter((r) => !r.passed);
    return failed.length === 0
      ? { passed: true, reason: results.map((r) => r.reason).join(' '), evidence: [] }
      : {
          passed: false,
          reason: failed.map((r) => r.reason).join(' '),
          evidence: failed.flatMap((r) => r.evidence),
        };
  }

  const q = 'none' in policy ? policy.none : policy.some;
  const rows = await runQuery(q, ctx);
  const passed = 'none' in policy ? rows.length === 0 : rows.length > 0;
  const described = describePolicy(policy);

  return {
    passed,
    reason: passed
      ? `Satisfied: ${described}.`
      : 'none' in policy
        ? `Blocked by ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} — requires ${described}.`
        : `Blocked: requires ${described}, found none.`,
    evidence: passed ? [] : rows.slice(0, 10),
  };
}

export function parsePolicy(raw: string): Policy | null {
  try {
    const parsed = JSON.parse(raw) as Policy;
    if (parsed && typeof parsed === 'object' && ('none' in parsed || 'some' in parsed || 'all' in parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Evaluate one gate and record the verdict. Every evaluation appends an event
 * carrying the reason and what satisfied it, so a blocked release can always
 * answer "because of what?".
 */
export async function evaluateGate(gateId: string, memberId?: string): Promise<GateEvaluation> {
  const gate = await db.gate.findUnique({ where: { id: gateId } });
  if (!gate) throw new Error(`Gate ${gateId} not found`);

  const policy = parsePolicy(gate.policy);
  if (!policy) {
    // An unparseable policy holds the gate rather than opening it. A gate that
    // fails open is worse than one that will not evaluate.
    const reason = `Gate "${gate.name}" has no evaluable policy, so it cannot pass. Set one on the gate.`;
    await db.gate.update({
      where: { id: gateId },
      data: { state: 'pending', reason, evaluatedAt: new Date(), evidence: '[]' },
    });
    return { passed: false, reason, evidence: [] };
  }

  const result = await evaluatePolicy(policy, { orgId: gate.orgId, projectId: gate.projectId });

  await db.gate.update({
    where: { id: gateId },
    data: {
      state: result.passed ? 'passed' : 'blocked',
      reason: result.reason,
      evidence: JSON.stringify(result.evidence),
      evaluatedAt: new Date(),
    },
  });

  // Two events: the evaluation itself, always, carrying the policy that ran and
  // the verdict; then the verdict as its own typed event, which is what the
  // chat and decision surfaces project.
  const spine = new EventSpine(gate.tenantId, gate.orgId);
  await spine.append([
    {
      type: 'GateEvaluated',
      actorType: memberId ? 'member' : 'system',
      actorMemberId: memberId ?? undefined,
      scopeType: 'project',
      scopeId: gate.projectId,
      payload: {
        gateId: gate.id,
        name: gate.name,
        policy: describePolicy(policy),
        result: result.passed ? 'passed' : 'blocked',
        reason: result.reason,
      },
    },
    result.passed
      ? {
          type: 'GatePassed' as const,
          actorType: (memberId ? 'member' : 'system') as 'member' | 'system',
          actorMemberId: memberId ?? undefined,
          scopeType: 'project' as const,
          scopeId: gate.projectId,
          payload: { gateId: gate.id, name: gate.name },
        }
      : {
          type: 'GateBlocked' as const,
          actorType: (memberId ? 'member' : 'system') as 'member' | 'system',
          actorMemberId: memberId ?? undefined,
          scopeType: 'project' as const,
          scopeId: gate.projectId,
          payload: {
            gateId: gate.id,
            name: gate.name,
            reason: result.reason,
            blockingRiskIds: result.evidence.map((e) => e.id),
          },
        },
  ]);

  return result;
}

/**
 * Re-evaluate every gate on a project.
 *
 * This is what makes gates live: a claim moving to `falsified` re-runs them
 * without anyone asking. Before, a gate's state was whatever the debate script
 * last wrote.
 */
export async function reevaluateGatesForProject(
  orgId: string,
  projectId: string,
): Promise<Array<{ gateId: string; name: string; passed: boolean; reason: string }>> {
  const gates = await db.gate.findMany({ where: { orgId, projectId }, select: { id: true, name: true } });
  const out: Array<{ gateId: string; name: string; passed: boolean; reason: string }> = [];
  for (const g of gates) {
    const result = await evaluateGate(g.id);
    out.push({ gateId: g.id, name: g.name, passed: result.passed, reason: result.reason });
  }
  return out;
}
