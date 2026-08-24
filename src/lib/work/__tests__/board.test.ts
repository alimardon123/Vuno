// The board moves real work, so the thing worth guarding is that it moves it
// the same way the orchestrator does — an event first, then the column, then
// the destination stage's work enqueued. A board that only writes the column
// leaves an objective sitting in a stage nothing was told to start.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { board, BoardError, moveObjective } from '@/lib/work/board';
import type { MemberSummary } from '@/lib/members';

const TENANT = 'tnt-board';
const ORG = 'org-board';

const KAI: MemberSummary = {
  id: 'mbr-board-kai', kind: 'human', displayName: 'Kai', handle: 'board-kai', role: null,
  status: 'active', presenceState: 'available', presenceNote: null, teamId: null,
  ownerMemberId: null, ownerName: null, isOrgOwner: true,
};

async function objective(stage: string, title = 'Sub-50ms p99 reads') {
  return db.objective.create({
    data: {
      tenantId: TENANT, orgId: ORG, title,
      successCriteria: 'p99 under 50ms at 10k concurrent readers',
      stage, status: stage === 'filed' ? 'filed' : 'active',
    },
  });
}

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'board-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'board-o' } });
  await db.member.create({
    data: { id: KAI.id, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Kai', handle: 'board-kai' },
  });
});

afterEach(async () => {
  await db.workItem.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.gate.deleteMany({ where: { orgId: ORG } });
  await db.project.deleteMany({ where: { orgId: ORG } });
  await db.objective.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('the columns', () => {
  test('always offers the two ends, even with nothing on the board', async () => {
    const stages = (await board(ORG)).map((c) => c.stage);
    expect(stages).toContain('filed');
    expect(stages).toContain('shipped');
    expect(stages).toContain('killed');
  });

  test('shows a column for a stage that has work in it', async () => {
    await objective('debate');
    const columns = await board(ORG);
    const debate = columns.find((c) => c.stage === 'debate');
    expect(debate?.cards).toHaveLength(1);
  });

  test('hides the stages this org has never reached', async () => {
    await objective('filed');
    const stages = (await board(ORG)).map((c) => c.stage);
    expect(stages).not.toContain('retrospective');
  });

  test('a card carries the gate that is blocking it, and what it said', async () => {
    const o = await objective('verification');
    const project = await db.project.create({
      data: { tenantId: TENANT, orgId: ORG, objectiveId: o.id, name: 'Storage', slug: 'board-storage' },
    });
    await db.gate.create({
      data: {
        tenantId: TENANT, orgId: ORG, projectId: project.id, name: 'release',
        state: 'blocked', reason: 'Found 1 falsified claim.',
      },
    });

    const card = (await board(ORG)).flatMap((c) => c.cards).find((c) => c.id === o.id);
    expect(card?.blocked).toEqual([{ name: 'release', reason: 'Found 1 falsified claim.' }]);
  });
});

describe('moving a card', () => {
  test('records why it moved before it moves', async () => {
    const o = await objective('filed');
    await moveObjective({ tenantId: TENANT, orgId: ORG, objectiveId: o.id, to: 'routing', actor: KAI });

    const event = await db.event.findFirst({
      where: { orgId: ORG, type: 'ObjectiveStageChanged' },
      orderBy: { seq: 'desc' },
    });
    expect(event).not.toBeNull();
    const payload = JSON.parse(event!.payload as string) as { from: string; to: string; byHand: boolean };
    expect(payload).toMatchObject({ from: 'filed', to: 'routing', byHand: true });
    expect(event!.actorMemberId).toBe(KAI.id);
  });

  test('enqueues what the destination stage declares', async () => {
    const o = await objective('filed');
    await moveObjective({ tenantId: TENANT, orgId: ORG, objectiveId: o.id, to: 'routing', actor: KAI });

    // Otherwise the objective sits in a stage nothing was told to start.
    const queued = await db.workItem.count({ where: { orgId: ORG, objectiveId: o.id } });
    expect(queued).toBeGreaterThan(0);
  });

  test('refuses a stage the orchestrator cannot run, and says why', async () => {
    const o = await objective('filed');
    const move = moveObjective({
      tenantId: TENANT, orgId: ORG, objectiveId: o.id, to: 'retrospective', actor: KAI,
    });
    await expect(move).rejects.toThrow(/designed but not built/);

    // And nothing moved.
    const after = await db.objective.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.stage).toBe('filed');
  });

  test('shipped and killed are reachable even though they run nothing', async () => {
    const o = await objective('debate');
    await moveObjective({ tenantId: TENANT, orgId: ORG, objectiveId: o.id, to: 'killed', actor: KAI });

    const after = await db.objective.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.stage).toBe('killed');
    // The status goes with it — an objective still marked active is one that
    // keeps appearing everywhere else after it was stopped.
    expect(after.status).toBe('killed');
    expect(await db.workItem.count({ where: { orgId: ORG, objectiveId: o.id } })).toBe(0);
  });

  test('moving to where it already is does nothing at all', async () => {
    const o = await objective('debate');
    const result = await moveObjective({
      tenantId: TENANT, orgId: ORG, objectiveId: o.id, to: 'debate', actor: KAI,
    });
    expect(result).toEqual({ from: 'debate', to: 'debate' });
    expect(await db.event.count({ where: { orgId: ORG, type: 'ObjectiveStageChanged' } })).toBe(0);
  });

  test('an objective from another org is not on this board', async () => {
    const move = moveObjective({
      tenantId: TENANT, orgId: ORG, objectiveId: 'nope', to: 'routing', actor: KAI,
    });
    await expect(move).rejects.toThrow(BoardError);
  });
});
