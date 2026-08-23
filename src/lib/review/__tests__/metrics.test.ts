// Evaluation the org can trust, or none.
//
// What this replaced scored agents on how much they said. Saying more is not
// working better: a devil's advocate who raises one objection that turns out to
// be right did more than one who raised nine that went nowhere.
//
// The rule these tests hold is the uncomfortable one — a member with too little
// history gets no score at all. 1/1 is not a track record, and rendering it as
// 100% invites a promotion it cannot support.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { ENOUGH_TO_JUDGE, reviewOrg } from '@/lib/review/metrics';

const TENANT = 'tnt-review';
const ORG = 'org-review';
const PROJECT = 'proj-review';
const DEVI = 'mbr-review-devi';   // an agent
const MIRA = 'mbr-review-mira';   // a person

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'review-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'review-o' } });
  await db.project.create({ data: { id: PROJECT, tenantId: TENANT, orgId: ORG, name: 'P', slug: 'review-p' } });
  await db.member.create({
    data: {
      id: DEVI, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Devi', handle: 'review-devi',
      agent: { create: { role: 'devils_advocate', modelName: 'm', harnessName: 'anthropic' } },
    },
  });
  await db.member.create({
    data: {
      id: MIRA, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Mira', handle: 'review-mira',
      human: { create: { email: 'mira@review.test' } },
    },
  });
});

afterEach(async () => {
  await db.workSession.deleteMany({ where: { orgId: ORG } });
  await db.claim.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.objective.deleteMany({ where: { orgId: ORG } });
  await db.gate.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.project.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

/** An objection, and the claim it became. `provenanceEventId` is the link. */
async function objectionBecomingClaim(memberId: string, statement: string, status: string) {
  const { EventSpine } = await import('@/lib/events/spine');
  const [event] = await new EventSpine(TENANT, ORG).append([
    {
      type: 'ObjectionRaised', actorType: 'member', actorMemberId: memberId,
      scopeType: 'project', scopeId: PROJECT,
      payload: { decisionId: 'dec-1', claimText: statement, severity: 'medium' },
    },
  ]);
  await db.claim.create({
    data: {
      tenantId: TENANT, orgId: ORG, statement, status,
      scopeType: 'project', scopeId: PROJECT,
      provenanceEventId: event.id, provenanceActorType: 'member', provenanceMemberId: memberId,
      updatedAt: new Date(),
    },
  });
}

async function claim(memberId: string, statement: string, status: string) {
  await db.claim.create({
    data: {
      tenantId: TENANT, orgId: ORG, statement, status,
      scopeType: 'project', scopeId: PROJECT,
      provenanceEventId: `ev-${statement}`, provenanceActorType: 'member', provenanceMemberId: memberId,
      updatedAt: new Date(),
    },
  });
}

const of = (r: Awaited<ReturnType<typeof reviewOrg>>, id: string) =>
  r.members.find((m) => m.memberId === id)!;

describe('a score needs a track record', () => {
  test('too few settled claims gives no survival rate, only the counts', async () => {
    await claim(DEVI, 'one', 'tested');
    await claim(DEVI, 'two', 'falsified');

    const devi = of(await reviewOrg(ORG), DEVI);
    expect(devi.claims.tested).toBe(1);
    expect(devi.claims.falsified).toBe(1);
    // 1/2 would render as 50% and mean nothing.
    expect(devi.claimSurvival).toBeNull();
  });

  test('enough settled claims gives a rate', async () => {
    for (let i = 0; i < 3; i++) await claim(DEVI, `held ${i}`, 'tested');
    await claim(DEVI, 'wrong', 'falsified');

    const devi = of(await reviewOrg(ORG), DEVI);
    expect(devi.claims.total).toBe(4);
    expect(devi.claimSurvival).toBeCloseTo(0.75, 5);
  });

  test('the threshold is the same for objections', async () => {
    await objectionBecomingClaim(DEVI, 'first', 'tested');
    const one = of(await reviewOrg(ORG), DEVI);
    expect(one.objections.upheld).toBe(1);
    expect(one.objectionPrecision).toBeNull();

    for (let i = 0; i < ENOUGH_TO_JUDGE; i++) {
      await objectionBecomingClaim(DEVI, `later ${i}`, i === 0 ? 'falsified' : 'tested');
    }
    const many = of(await reviewOrg(ORG), DEVI);
    expect(many.objections.raised).toBe(ENOUGH_TO_JUDGE + 1);
    expect(many.objectionPrecision).toBeCloseTo(4 / 5, 5);
  });
});

describe('what counts as working', () => {
  test('a claim nobody tested is not a survival', async () => {
    // Three standing claims and one falsified: never being checked is not a
    // record of being right.
    for (let i = 0; i < 3; i++) await claim(DEVI, `standing ${i}`, 'asserted');
    await claim(DEVI, 'checked and wrong', 'falsified');

    const devi = of(await reviewOrg(ORG), DEVI);
    expect(devi.claims.standing).toBe(3);
    // Only one settled, so no rate — and certainly not 75%.
    expect(devi.claimSurvival).toBeNull();
  });

  test('an objection is scored by what happened to the claim it became', async () => {
    await objectionBecomingClaim(DEVI, 'right 1', 'tested');
    await objectionBecomingClaim(DEVI, 'right 2', 'tested');
    await objectionBecomingClaim(DEVI, 'right 3', 'tested');
    await objectionBecomingClaim(DEVI, 'wrong 1', 'falsified');

    const devi = of(await reviewOrg(ORG), DEVI);
    expect(devi.objections).toEqual({ raised: 4, upheld: 3, overturned: 1 });
    expect(devi.objectionPrecision).toBeCloseTo(0.75, 5);
  });

  test('objections that went nowhere are raised but do not count either way', async () => {
    await objectionBecomingClaim(DEVI, 'open 1', 'asserted');
    await objectionBecomingClaim(DEVI, 'open 2', 'uncertain');

    const devi = of(await reviewOrg(ORG), DEVI);
    expect(devi.objections.raised).toBe(2);
    expect(devi.objections.upheld + devi.objections.overturned).toBe(0);
  });
});

describe('a person and an agent are measured the same way', () => {
  test('both appear with the same shape (ADR-0009)', async () => {
    for (let i = 0; i < 4; i++) await claim(MIRA, `mira ${i}`, i === 0 ? 'falsified' : 'tested');
    for (let i = 0; i < 4; i++) await claim(DEVI, `devi ${i}`, 'tested');

    const review = await reviewOrg(ORG);
    const mira = of(review, MIRA);
    const devi = of(review, DEVI);

    expect(mira.kind).toBe('human');
    expect(devi.kind).toBe('agent');
    expect(mira.claimSurvival).toBeCloseTo(0.75, 5);
    expect(devi.claimSurvival).toBe(1);
    expect(Object.keys(mira).sort()).toEqual(Object.keys(devi).sort());
  });
});

describe('what the org spent, and where it is stuck', () => {
  test('runs and cost are summed per member and for the org', async () => {
    await db.workItem.create({
      data: { id: 'wi-review', tenantId: TENANT, orgId: ORG, kind: 'agent_turn', subjectType: 'channel', subjectId: 'x' },
    });
    for (const [member, outcome, cents, ms] of [
      [DEVI, 'succeeded', 2, 400],
      [DEVI, 'succeeded', 3, 800],
      [DEVI, 'failed', 0, 120],
    ] as const) {
      await db.workSession.create({
        data: {
          tenantId: TENANT, orgId: ORG, workItemId: 'wi-review',
          memberId: member, outcome, costCents: cents, durationMs: ms,
        },
      });
    }

    const review = await reviewOrg(ORG);
    const devi = of(review, DEVI);
    expect(devi.runs).toEqual({ total: 3, succeeded: 2, failed: 1, costCents: 5, medianMs: 400 });
    expect(review.spend).toEqual({ totalCents: 5, runs: 3, failedRuns: 1 });

    await db.workSession.deleteMany({ where: { orgId: ORG } });
    await db.workItem.deleteMany({ where: { orgId: ORG } });
  });

  test('escalation rate is the share of objectives the orchestrator cannot advance', async () => {
    await db.objective.create({
      data: {
        id: 'obj-r1', tenantId: TENANT, orgId: ORG, title: 'A', successCriteria: 'x',
        autonomyLevel: 'L2', stage: 'decision', status: 'active',
      },
    });
    await db.objective.create({
      data: {
        id: 'obj-r2', tenantId: TENANT, orgId: ORG, title: 'B', successCriteria: 'y',
        autonomyLevel: 'L2', stage: 'filed', status: 'active',
      },
    });

    const review = await reviewOrg(ORG);
    // 'decision' has no handler; 'filed' does.
    expect(review.escalation.parked).toBe(1);
    expect(review.escalation.total).toBe(2);
    expect(review.escalation.rate).toBeCloseTo(0.5, 5);
  });

  test('an org with no objectives has no escalation rate rather than zero', async () => {
    const review = await reviewOrg(ORG);
    expect(review.escalation.rate).toBeNull();
  });

  test('the ledger summary counts what the org is unsure about', async () => {
    await claim(DEVI, 'a', 'falsified');
    await claim(DEVI, 'b', 'uncertain');
    await claim(MIRA, 'c', 'tested');

    const review = await reviewOrg(ORG);
    expect(review.ledger).toEqual({ total: 3, falsified: 1, uncertain: 1 });
  });

  test('a retired member is not scored', async () => {
    await claim(DEVI, 'a', 'tested');
    await db.member.update({ where: { id: DEVI }, data: { status: 'retired' } });
    try {
      const review = await reviewOrg(ORG);
      expect(review.members.find((m) => m.memberId === DEVI)).toBeUndefined();
    } finally {
      await db.member.update({ where: { id: DEVI }, data: { status: 'active' } });
    }
  });
});
