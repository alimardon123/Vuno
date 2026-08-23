// Vuno — how the organisation is working, as queries rather than opinions.
//
// The vision doc asks for continuous evaluation, and the risk it names is that
// this becomes a scoreboard nobody trusts. Everything here is derived from the
// spine and the ledger, so each number can be traced to the events behind it
// and none of it needs a model to produce.
//
// What was deleted with the simulated agents was 360 lines of `/api/hr-metrics`
// that scored agents on activity — how much they said. Saying more is not
// working better; a devil's advocate who raises one objection that turns out to
// be right did more than one who raised nine that went nowhere.
//
// Two rules:
//   - A member with too little history gets no score. A precision of 1/1 is
//     not a track record, and rendering it as 100% invites a decision it
//     cannot support.
//   - A person and an agent are measured the same way (ADR-0009). Every column
//     used here is on Member, not on AgentProfile.

import { db } from '@/lib/db';
import { isStage, STAGES } from '@/lib/orchestrator/stages';

/** Below this, a rate is noise. Reported as a count, not a percentage. */
export const ENOUGH_TO_JUDGE = 4;

export interface MemberReview {
  memberId: string;
  name: string;
  kind: 'human' | 'agent';
  role: string | null;

  /** Claims this member put on the ledger, by where they ended up. */
  claims: { total: number; standing: number; tested: number; falsified: number; uncertain: number };
  /**
   * Of the claims that were settled either way, the share that survived.
   * Null when too few have settled to mean anything.
   */
  claimSurvival: number | null;

  /** Objections that became claims, and what happened to those claims. */
  objections: { raised: number; upheld: number; overturned: number };
  /** Of the objections that were settled, the share that were right. Null when too few. */
  objectionPrecision: number | null;

  /** What this member's runs did, and cost. */
  runs: { total: number; succeeded: number; failed: number; costCents: number; medianMs: number | null };
}

export interface OrgReview {
  members: MemberReview[];
  /** Objectives sitting at a stage the orchestrator cannot advance. */
  escalation: { parked: number; total: number; rate: number | null };
  /** What the organisation has spent, and on what. */
  spend: { totalCents: number; runs: number; failedRuns: number };
  gates: { blocked: number; total: number };
  ledger: { total: number; falsified: number; uncertain: number };
}

function share(numerator: number, denominator: number): number | null {
  return denominator >= ENOUGH_TO_JUDGE ? numerator / denominator : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

export async function reviewOrg(orgId: string): Promise<OrgReview> {
  const [members, claims, objectionEvents, sessions, objectives, gates] = await Promise.all([
    db.member.findMany({
      where: { orgId, status: 'active' },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, kind: true, agent: { select: { role: true } } },
    }),
    db.claim.findMany({
      where: { orgId },
      select: { id: true, status: true, provenanceMemberId: true, provenanceEventId: true },
    }),
    db.event.findMany({
      where: { orgId, type: 'ObjectionRaised' },
      select: { id: true, actorMemberId: true },
    }),
    db.workSession.findMany({
      where: { orgId },
      select: { memberId: true, outcome: true, costCents: true, durationMs: true },
    }),
    db.objective.findMany({ where: { orgId }, select: { stage: true, status: true } }),
    db.gate.findMany({ where: { orgId }, select: { state: true } }),
  ]);

  // An objection becomes a claim, and that claim's fate is the objection's
  // outcome. The link is `provenanceEventId` — the event that originated the
  // claim — so this is a join, not a guess at what a message meant.
  const objectionBy = new Map(objectionEvents.map((e) => [e.id, e.actorMemberId]));

  const review = members.map((m): MemberReview => {
    const mine = claims.filter((c) => c.provenanceMemberId === m.id);
    const byStatus = (s: string) => mine.filter((c) => c.status === s).length;
    const tested = byStatus('tested');
    const falsified = byStatus('falsified');
    const standing = byStatus('asserted') + byStatus('believed');

    const fromObjections = claims.filter(
      (c) => objectionBy.get(c.provenanceEventId) === m.id,
    );
    const upheld = fromObjections.filter((c) => c.status === 'tested').length;
    const overturned = fromObjections.filter((c) => c.status === 'falsified').length;

    const runs = sessions.filter((s) => s.memberId === m.id);
    const durations = runs.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number');

    return {
      memberId: m.id,
      name: m.displayName,
      kind: m.kind as 'human' | 'agent',
      role: m.agent?.role ?? null,
      claims: { total: mine.length, standing, tested, falsified, uncertain: byStatus('uncertain') },
      // Settled means the evidence decided it. A claim still standing has not
      // been tested, and counting it as a survival would reward never being
      // checked.
      claimSurvival: share(tested, tested + falsified),
      objections: { raised: fromObjections.length, upheld, overturned },
      objectionPrecision: share(upheld, upheld + overturned),
      runs: {
        total: runs.length,
        succeeded: runs.filter((r) => r.outcome === 'succeeded').length,
        failed: runs.filter((r) => r.outcome === 'failed').length,
        costCents: runs.reduce((sum, r) => sum + r.costCents, 0),
        medianMs: median(durations),
      },
    };
  });

  const parked = objectives.filter((o) => {
    const stage = isStage(o.stage) ? o.stage : 'filed';
    return o.status !== 'shipped' && !STAGES[stage].implemented;
  }).length;

  return {
    members: review,
    // The health metric the workflow doc names: if everything escalates, the
    // org has made you the bottleneck it was meant to remove.
    escalation: {
      parked,
      total: objectives.length,
      rate: objectives.length > 0 ? parked / objectives.length : null,
    },
    spend: {
      totalCents: sessions.reduce((sum, s) => sum + s.costCents, 0),
      runs: sessions.length,
      failedRuns: sessions.filter((s) => s.outcome === 'failed').length,
    },
    gates: { blocked: gates.filter((g) => g.state === 'blocked').length, total: gates.length },
    ledger: {
      total: claims.length,
      falsified: claims.filter((c) => c.status === 'falsified').length,
      uncertain: claims.filter((c) => c.status === 'uncertain').length,
    },
  };
}
