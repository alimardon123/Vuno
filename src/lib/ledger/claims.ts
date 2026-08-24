// Vuno — the epistemic ledger (ADR-0005)
//
// The product's one differentiating idea: a claim has a status, and **debate is
// the state-transition function**. That was never implemented. `/api/debate`
// minted a fresh decision id from the clock, derived a claim id from it, and
// inserted a row that was *born* `falsified` — the outcome fixed at line 359,
// before any agent ran. Nine runs produced nine identical claims instead of one
// claim with a history.
//
// Here, a claim is asserted once and then only ever transitions. Status moves
// exclusively by appending `ClaimStatusChanged`, and `Claim.status` is a
// projection of that log — which is why replaying from seq 0 reproduces it.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { ClaimStatus } from '@/lib/events/types';
import { reevaluateGatesForProject } from '@/lib/gates';

export const CLAIM_STATUSES = ['asserted', 'believed', 'tested', 'falsified', 'uncertain'] as const;

/**
 * Which moves are legal, and why.
 *
 * A claim can always become `uncertain` — new doubt is always admissible. What
 * it cannot do is go straight from `asserted` to `tested` without anyone having
 * believed it enough to test, or move at all once `falsified` except by being
 * superseded, which creates a new claim rather than reviving this one.
 */
const LEGAL: Record<ClaimStatus, ClaimStatus[]> = {
  asserted: ['believed', 'falsified', 'uncertain'],
  believed: ['tested', 'falsified', 'uncertain'],
  tested: ['falsified', 'uncertain'],
  uncertain: ['asserted', 'believed', 'tested', 'falsified'],
  falsified: [],
};

export class IllegalTransition extends Error {
  constructor(from: ClaimStatus, to: ClaimStatus) {
    super(
      from === to
        ? `Claim is already ${from}; a transition must change the status.`
        : `${/^[aeiou]/.test(from) ? 'An' : 'A'} ${from} claim cannot become ${to}. From ${from} it can move to: ${LEGAL[from].join(', ') || 'nothing — falsified is terminal, so supersede it with a new claim instead'}.`,
    );
    this.name = 'IllegalTransition';
  }
}

export interface AssertInput {
  tenantId: string;
  orgId: string;
  statement: string;
  scopeType: string;
  scopeId: string;
  memberId?: string | null;
  provenanceEventId?: string;
  /** Claims start asserted. Anything else needs evidence, so it needs a transition. */
  status?: Extract<ClaimStatus, 'asserted' | 'uncertain'>;
}

/**
 * Assert a claim, or return the one that already exists.
 *
 * Idempotent by (org, scope, statement): saying the same thing twice does not
 * make it two claims. This is the structural fix for the duplicate rows.
 */
export async function assertClaim(input: AssertInput): Promise<{ id: string; created: boolean }> {
  const existing = await db.claim.findFirst({
    where: {
      orgId: input.orgId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      statement: input.statement,
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await db.claim.create({
    data: {
      tenantId: input.tenantId,
      orgId: input.orgId,
      statement: input.statement,
      status: input.status ?? 'asserted',
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      provenanceEventId: input.provenanceEventId ?? 'assertion',
      provenanceActorType: input.memberId ? 'member' : 'system',
      provenanceMemberId: input.memberId ?? null,
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

export interface TransitionInput {
  claimId: string;
  to: ClaimStatus;
  /** Why, in the words a reader can act on. Required — a status change with no reason is not evidence. */
  reason: string;
  /** The events that justify the move: a benchmark, an incident, a paper. */
  evidenceEventIds?: string[];
  memberId?: string | null;
  scopeType?: string;
  scopeId?: string;
  /** When the move happened, when that differs from now — seeding and import. */
  occurredAt?: Date;
}

/**
 * Move a claim's status. The event is appended first and the row is updated to
 * match, so the log is the truth and the column is the cache — never the other
 * way round.
 */
export async function transitionClaim(input: TransitionInput): Promise<{
  from: ClaimStatus;
  to: ClaimStatus;
  eventId: string;
  /** Gates re-evaluated as a consequence, with their new verdicts. */
  gates: Array<{ gateId: string; name: string; passed: boolean; reason: string }>;
}> {
  const claim = await db.claim.findUnique({ where: { id: input.claimId } });
  if (!claim) throw new Error(`Claim ${input.claimId} not found`);

  const from = claim.status as ClaimStatus;
  if (!LEGAL[from]?.includes(input.to)) throw new IllegalTransition(from, input.to);

  const spine = new EventSpine(claim.tenantId, claim.orgId);
  const [event] = await spine.append([
    {
      type: 'ClaimStatusChanged',
      actorType: input.memberId ? 'member' : 'system',
      actorMemberId: input.memberId ?? undefined,
      scopeType: (input.scopeType ?? claim.scopeType) as never,
      scopeId: input.scopeId ?? claim.scopeId,
      payload: {
        claimId: claim.id,
        from,
        to: input.to,
        reason: input.reason,
        evidenceEventId: input.evidenceEventIds?.[0],
      },
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
  ]);

  const evidence: string[] = JSON.parse(claim.evidenceIds || '[]');
  await db.claim.update({
    where: { id: claim.id },
    data: {
      status: input.to,
      statusReason: input.reason,
      evidenceIds: JSON.stringify([...new Set([...evidence, ...(input.evidenceEventIds ?? [])])]),
      updatedAt: input.occurredAt ?? new Date(),
    },
  });

  // A claim moving is exactly when a gate's verdict may have changed. Nothing
  // has to ask — this is what makes gates live rather than whatever the last
  // script wrote (ADR-0007 §C).
  const gates =
    claim.scopeType === 'project'
      ? await reevaluateGatesForProject(claim.orgId, claim.scopeId)
      : [];

  return { from, to: input.to, eventId: event.id, gates };
}

/**
 * Fold every ClaimStatusChanged from seq 0 into the state it implies.
 *
 * This is the audit: if this disagrees with the stored `status` column, the
 * ledger has been written behind the log's back and nothing it says can be
 * trusted. A test asserts they match.
 */
export async function replayClaimStatuses(orgId: string): Promise<Map<string, ClaimStatus>> {
  const events = await db.event.findMany({
    where: { orgId, type: 'ClaimStatusChanged' },
    orderBy: { seq: 'asc' },
    select: { payload: true },
  });

  const state = new Map<string, ClaimStatus>();
  for (const e of events) {
    try {
      const p = JSON.parse(e.payload as string) as { claimId?: string; to?: ClaimStatus };
      if (p.claimId && p.to) state.set(p.claimId, p.to);
    } catch {
      // A payload that will not parse cannot move anything. The validation
      // boundary keeps these out; skipping is the safe reading here.
    }
  }
  return state;
}

/** The transition trail for one claim, oldest first — what the ledger UI renders. */
export async function claimHistory(claimId: string): Promise<
  Array<{ from: ClaimStatus; to: ClaimStatus; reason: string; at: string; seq: number; memberId: string | null }>
> {
  const events = await db.event.findMany({
    where: { type: 'ClaimStatusChanged' },
    orderBy: { seq: 'asc' },
    select: { payload: true, createdAt: true, seq: true, actorMemberId: true },
  });

  const out: Array<{ from: ClaimStatus; to: ClaimStatus; reason: string; at: string; seq: number; memberId: string | null }> = [];
  for (const e of events) {
    try {
      const p = JSON.parse(e.payload as string) as {
        claimId?: string; from?: ClaimStatus; to?: ClaimStatus; reason?: string;
      };
      if (p.claimId !== claimId || !p.from || !p.to) continue;
      out.push({
        from: p.from,
        to: p.to,
        reason: p.reason ?? '',
        at: String(e.createdAt),
        seq: e.seq,
        memberId: e.actorMemberId,
      });
    } catch {
      continue;
    }
  }
  return out;
}
