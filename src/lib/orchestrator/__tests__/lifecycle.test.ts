// The gate for P1: file an objective, walk away, and find it has moved — and
// kill the worker mid-run without losing the work.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
// The shared test database is created by tests/setup.ts before any import.
import { db } from '@/lib/db';

const TENANT = 'tnt-l';
const ORG = 'org-l';

async function fileObjective(title: string, criteria: string) {
  return db.objective.create({
    data: {
      tenantId: TENANT, orgId: ORG, title, successCriteria: criteria,
      status: 'filed', stage: 'filed',
    },
  });
}

beforeAll(async () => {

  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'l-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'l-o' } });
  for (const [id, name] of [['d-prod', 'Product'], ['d-eng', 'Engineering']] as const) {
    await db.department.create({ data: { id, tenantId: TENANT, orgId: ORG, name, slug: name.toLowerCase() } });
  }
  for (const [id, name, role] of [
    ['m-maya', 'Maya', 'product'],
    ['m-ravi', 'Ravi', 'research'],
  ] as const) {
    await db.member.create({
      data: {
        id, tenantId: TENANT, orgId: ORG, kind: 'agent',
        displayName: name, handle: name.toLowerCase(),
        agent: { create: { role } },
      },
    });
  }
});

afterAll(async () => {
  // Scoped teardown: other test files share this database.
  await db.workSession.deleteMany({ where: { orgId: 'org-l' } });
  await db.workItem.deleteMany({ where: { orgId: 'org-l' } });
  await db.claim.deleteMany({ where: { orgId: 'org-l' } });
  await db.event.deleteMany({ where: { orgId: 'org-l' } });
  await db.membership.deleteMany({ where: { orgId: 'org-l' } });
  await db.objective.deleteMany({ where: { orgId: 'org-l' } });
  await db.member.deleteMany({ where: { orgId: 'org-l' } });
  await db.team.deleteMany({ where: { orgId: 'org-l' } });
  await db.department.deleteMany({ where: { orgId: 'org-l' } });
  await db.organization.deleteMany({ where: { id: 'org-l' } });
  await db.tenant.deleteMany({ where: { id: 'tnt-l' } });
});

beforeEach(async () => {
  await db.workSession.deleteMany({ where: { orgId: 'org-l' } });
  await db.workItem.deleteMany({ where: { orgId: 'org-l' } });
  await db.claim.deleteMany({ where: { orgId: 'org-l' } });
  await db.event.deleteMany({ where: { orgId: 'org-l' } });
  await db.objective.deleteMany({ where: { orgId: 'org-l' } });
});

describe('an objective moves on its own', () => {
  test('filed → routing → problem_definition → divergent_proposal, unattended', async () => {
    const { enqueueStageWork, tick } = await import('../runner');
    const objective = await fileObjective(
      'Build a storage engine with sub-50ms p99 read latency',
      'p99 < 50ms at 10k concurrent readers',
    );

    // Filing enqueues the first step. Nothing else is pushed by hand.
    await enqueueStageWork(TENANT, ORG, objective.id, 'filed');

    // Drain, exactly as the loop would.
    const stages: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await tick({ orgId: ORG, workerId: 'w1' });
      if (!r.handled) break;
      if (r.advancedTo) stages.push(r.advancedTo);
    }

    expect(stages).toEqual(['routing', 'problem_definition', 'divergent_proposal']);

    const after = await db.objective.findUnique({ where: { id: objective.id } });
    expect(after?.stage).toBe('divergent_proposal');
    expect(after?.status).toBe('active');
    // Product by default, which is what the workflow doc specifies: an objective
    // lands with Product, whose lead assembles the group and pulls in Research.
    expect(after?.owningDepartment).toBe('Product');
  });

  test('an explicit owning department is honoured over the default', async () => {
    const { enqueueStageWork, tick } = await import('../runner');
    const objective = await db.objective.create({
      data: {
        tenantId: TENANT, orgId: ORG, title: 'Harden the auth path',
        successCriteria: 'no high-severity findings', status: 'filed', stage: 'filed',
        owningDepartment: 'Engineering',
      },
    });
    await enqueueStageWork(TENANT, ORG, objective.id, 'filed');
    await tick({ orgId: ORG, workerId: 'w1' });

    expect((await db.objective.findUnique({ where: { id: objective.id } }))?.owningDepartment)
      .toBe('Engineering');
  });

  test('every step is recorded as a session with a member and a duration', async () => {
    const { enqueueStageWork, tick } = await import('../runner');
    const objective = await fileObjective('Ship a thing', 'latency under 100ms');
    await enqueueStageWork(TENANT, ORG, objective.id, 'filed');

    for (let i = 0; i < 12; i++) {
      if (!(await tick({ orgId: ORG, workerId: 'w1' })).handled) break;
    }

    const sessions = await db.workSession.findMany({ orderBy: { startedAt: 'asc' } });
    expect(sessions.length).toBeGreaterThanOrEqual(4);
    expect(sessions.every((s) => s.outcome === 'succeeded')).toBe(true);
    expect(sessions.every((s) => typeof s.durationMs === 'number')).toBe(true);
    // The interrogation steps ran as real members, not as 'system'.
    expect(sessions.some((s) => s.memberId === 'm-maya' || s.memberId === 'm-ravi')).toBe(true);
  });

  test('an objective with no measurable criteria records an uncertain claim rather than drifting', async () => {
    const { enqueueStageWork, tick } = await import('../runner');
    const vague = await fileObjective('Make search better', 'users are happier');
    await enqueueStageWork(TENANT, ORG, vague.id, 'filed');
    for (let i = 0; i < 12; i++) {
      if (!(await tick({ orgId: ORG, workerId: 'w1' })).handled) break;
    }

    const claims = await db.claim.findMany({ where: { scopeId: vague.id } });
    expect(claims.length).toBeGreaterThan(0);
    const flagged = claims.find((c) => c.status === 'uncertain');
    expect(flagged?.statement).toContain('no measurable threshold');
    // And it has an author, because the member who raised it is recorded.
    expect(flagged?.provenanceMemberId).toBeTruthy();
  });

  test('a stage that fans out waits for every item before advancing', async () => {
    const { enqueueStageWork, tick } = await import('../runner');
    const objective = await fileObjective('Fan out', 'p99 under 50ms');
    // problem_definition enqueues two interrogations.
    await db.objective.update({ where: { id: objective.id }, data: { stage: 'problem_definition' } });
    await enqueueStageWork(TENANT, ORG, objective.id, 'problem_definition');

    const first = await tick({ orgId: ORG, workerId: 'w1' });
    expect(first.handled).toBe(true);
    // One of two done — the objective has not moved.
    expect((await db.objective.findUnique({ where: { id: objective.id } }))?.stage).toBe('problem_definition');

    await tick({ orgId: ORG, workerId: 'w1' });
    expect((await db.objective.findUnique({ where: { id: objective.id } }))?.stage).toBe('divergent_proposal');
  });
});

describe('surviving a crash', () => {
  test('a worker killed mid-run leaves the work recoverable, and it completes', async () => {
    const { enqueueStageWork, tick } = await import('../runner');
    const { claimNext, LEASE_MS } = await import('../queue');
    const objective = await fileObjective('Crash test', 'p99 under 50ms');
    await enqueueStageWork(TENANT, ORG, objective.id, 'filed');

    // A worker takes the item and dies: no complete, no fail, no heartbeat.
    const orphaned = await claimNext({ orgId: ORG, workerId: 'doomed-worker' });
    expect(orphaned).not.toBeNull();
    expect((await db.objective.findUnique({ where: { id: objective.id } }))?.stage).toBe('filed');

    // Nobody else can touch it while the lease is live.
    expect(await claimNext({ orgId: ORG, workerId: 'w2' })).toBeNull();

    // Once the lease lapses, a new worker picks it up and the objective moves.
    const revived = await claimNext({
      orgId: ORG, workerId: 'w2', now: new Date(Date.now() + LEASE_MS + 1000),
    });
    expect(revived?.id).toBe(orphaned!.id);

    // Hand it back so the normal path can finish the job.
    await db.workItem.update({
      where: { id: revived!.id },
      data: { state: 'pending', leasedBy: null, leaseExpiresAt: null },
    });
    for (let i = 0; i < 12; i++) {
      if (!(await tick({ orgId: ORG, workerId: 'w2' })).handled) break;
    }

    expect((await db.objective.findUnique({ where: { id: objective.id } }))?.stage).toBe('divergent_proposal');
  });

  test('a handler that throws is retried, and the objective does not advance past it', async () => {
    const { tick } = await import('../runner');
    const { enqueue } = await import('../queue');
    const objective = await fileObjective('Bad ref', 'p99 under 50ms');

    // Point the item at an objective that does not exist.
    await enqueue({
      tenantId: TENANT, orgId: ORG, kind: 'route_objective',
      subjectType: 'objective', subjectId: 'obj-missing',
      objectiveId: objective.id, maxAttempts: 2,
    });

    const r = await tick({ orgId: ORG, workerId: 'w1' });
    expect(r.error).toContain('not found');
    expect((await db.objective.findUnique({ where: { id: objective.id } }))?.stage).toBe('filed');

    const sessions = await db.workSession.findMany();
    expect(sessions[0]?.outcome).toBe('failed');
    expect(sessions[0]?.error).toContain('not found');
  });
});
