// ADR-0005: a claim has a status, and debate is the state-transition function.
// The shipped code never implemented it — /api/debate inserted a fresh row that
// was born `falsified`, so the database held nine identical claims and no claim
// had ever transitioned. These tests are the guard on the real behaviour.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';

const TENANT = 'tnt-ledger';
const ORG = 'org-ledger';
const PROJECT = 'proj-ledger';

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'ledger-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'ledger-o' } });
  await db.member.create({
    data: {
      id: 'mbr-peri', tenantId: TENANT, orgId: ORG, kind: 'agent',
      displayName: 'Peri', handle: 'peri-l', agent: { create: { role: 'perf' } },
    },
  });
  await db.project.create({
    data: { id: PROJECT, tenantId: TENANT, orgId: ORG, name: 'Storage', slug: 'storage-ledger' },
  });
});

afterAll(async () => {
  await db.gate.deleteMany({ where: { orgId: ORG } });
  await db.claim.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.project.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

beforeEach(async () => {
  await db.gate.deleteMany({ where: { orgId: ORG } });
  await db.claim.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
});

const P99 = 'p99 read latency < 50ms at 10k concurrent readers';
const claimBase = { tenantId: TENANT, orgId: ORG, scopeType: 'project', scopeId: PROJECT };

describe('claims are asserted once, then transition', () => {
  test('asserting the same statement twice yields one claim, not two', async () => {
    const { assertClaim } = await import('../claims');
    const a = await assertClaim({ ...claimBase, statement: P99 });
    const b = await assertClaim({ ...claimBase, statement: P99 });

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    expect(await db.claim.count({ where: { orgId: ORG } })).toBe(1);
  });

  test('the duplicate-claim bug cannot be reproduced: nine runs leave one row', async () => {
    const { assertClaim, transitionClaim } = await import('../claims');
    for (let i = 0; i < 9; i++) {
      const { id, created } = await assertClaim({ ...claimBase, statement: P99, memberId: 'mbr-peri' });
      if (created) {
        await transitionClaim({ claimId: id, to: 'believed', reason: 'Architect proposal accepted' });
      }
    }
    const rows = await db.claim.findMany({ where: { orgId: ORG } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('believed');
  });

  test('a benchmark falsifies a believed claim, and the trail records both moves', async () => {
    const { assertClaim, transitionClaim, claimHistory } = await import('../claims');
    const { id } = await assertClaim({ ...claimBase, statement: P99, memberId: 'mbr-peri' });

    await transitionClaim({ claimId: id, to: 'believed', reason: 'Proposal reviewed by three members' });
    const result = await transitionClaim({
      claimId: id,
      to: 'falsified',
      reason: 'Benchmark measured p99 = 142ms at 10k readers, against a 50ms target.',
      memberId: 'mbr-peri',
    });

    expect(result.from).toBe('believed');
    expect(result.to).toBe('falsified');

    const history = await claimHistory(id);
    expect(history.map((h) => `${h.from}→${h.to}`)).toEqual(['asserted→believed', 'believed→falsified']);
    expect(history[1].reason).toContain('142ms');
    expect(history[1].memberId).toBe('mbr-peri');
  });

  test('an illegal move is refused with a message that says what is legal', async () => {
    const { assertClaim, transitionClaim, IllegalTransition } = await import('../claims');
    const { id } = await assertClaim({ ...claimBase, statement: 'Bloom filters cost 1.5x memory' });

    // asserted → tested skips the step where anyone believed it.
    await expect(
      transitionClaim({ claimId: id, to: 'tested', reason: 'skipping ahead' }),
    ).rejects.toThrow(IllegalTransition);

    await transitionClaim({ claimId: id, to: 'falsified', reason: 'measured otherwise' });
    // falsified is terminal.
    await expect(
      transitionClaim({ claimId: id, to: 'believed', reason: 'changed my mind' }),
    ).rejects.toThrow(/terminal/);
  });

  test('a transition must actually change the status', async () => {
    const { assertClaim, transitionClaim } = await import('../claims');
    const { id } = await assertClaim({ ...claimBase, statement: 'A single node suffices' });
    await expect(
      transitionClaim({ claimId: id, to: 'asserted', reason: 'no-op' }),
    ).rejects.toThrow(/already asserted/);
  });
});

describe('the log is the truth', () => {
  test('replaying every ClaimStatusChanged from seq 0 reproduces the stored state exactly', async () => {
    const { assertClaim, transitionClaim, replayClaimStatuses } = await import('../claims');

    const a = await assertClaim({ ...claimBase, statement: P99 });
    const b = await assertClaim({ ...claimBase, statement: 'Group commit lifts writes above 40k ops/s' });
    const c = await assertClaim({ ...claimBase, statement: 'A single node suffices for 12 months' });

    await transitionClaim({ claimId: a.id, to: 'believed', reason: 'reviewed' });
    await transitionClaim({ claimId: a.id, to: 'falsified', reason: 'benchmark says 142ms' });
    await transitionClaim({ claimId: b.id, to: 'believed', reason: 'reviewed' });
    await transitionClaim({ claimId: c.id, to: 'uncertain', reason: 'no data either way' });

    const replayed = await replayClaimStatuses(ORG);
    const stored = await db.claim.findMany({ where: { orgId: ORG }, select: { id: true, status: true } });

    // Every claim that moved is in the replay, with the same status the row holds.
    for (const row of stored) {
      if (row.status === 'asserted') continue; // never moved, so no event to replay
      expect(replayed.get(row.id) as string).toBe(row.status);
    }
    expect(replayed.get(a.id)).toBe('falsified');
    expect(replayed.get(b.id)).toBe('believed');
    expect(replayed.get(c.id)).toBe('uncertain');
  });
});

describe('gates evaluate as queries and can name what blocked them', () => {
  async function makeGate(name: string, policy: unknown) {
    return db.gate.create({
      data: {
        tenantId: TENANT, orgId: ORG, projectId: PROJECT, name,
        policy: JSON.stringify(policy), state: 'pending',
      },
    });
  }

  test('a gate blocks because of a falsified claim, and says which one', async () => {
    const { assertClaim, transitionClaim } = await import('../claims');
    const { evaluateGate } = await import('@/lib/gates');

    const gate = await makeGate('performance', { none: { subject: 'claim', status: ['falsified'] } });

    // Nothing falsified yet — the gate passes.
    expect((await evaluateGate(gate.id)).passed).toBe(true);

    const { id } = await assertClaim({ ...claimBase, statement: P99 });
    await transitionClaim({ claimId: id, to: 'believed', reason: 'reviewed' });
    const moved = await transitionClaim({
      claimId: id, to: 'falsified', reason: 'p99 = 142ms against a 50ms target',
    });

    // The transition re-evaluated the gate on its own — nobody asked.
    const perf = moved.gates.find((g) => g.name === 'performance');
    expect(perf?.passed).toBe(false);

    const after = await evaluateGate(gate.id);
    expect(after.passed).toBe(false);
    expect(after.evidence).toHaveLength(1);
    expect(after.evidence[0].label).toContain(P99);
    expect(after.reason).toContain('requires no falsified claim');
  });

  test('an `all` policy reports every clause that failed', async () => {
    const { assertClaim, transitionClaim } = await import('../claims');
    const { evaluateGate } = await import('@/lib/gates');

    const gate = await makeGate('release', {
      all: [
        { none: { subject: 'claim', status: ['falsified'] } },
        { none: { subject: 'risk', severityAtLeast: 'high' } },
      ],
    });

    const { id } = await assertClaim({ ...claimBase, statement: P99 });
    await transitionClaim({ claimId: id, to: 'falsified', reason: 'measured 142ms' });

    const spine = new (await import('@/lib/events/spine')).EventSpine(TENANT, ORG);
    await spine.append([
      {
        type: 'RiskFlagged', actorType: 'system',
        scopeType: 'project', scopeId: PROJECT,
        payload: { scopeType: 'project', scopeId: PROJECT, severity: 'critical', description: 'Working set exceeds RAM' },
      },
    ]);

    const result = await evaluateGate(gate.id);
    expect(result.passed).toBe(false);
    expect(result.evidence.map((e) => e.kind).sort()).toEqual(['claim', 'risk']);
    expect(result.reason).toContain('falsified claim');
    expect(result.reason).toContain('risk');
  });

  test('a low-severity risk does not trip a high-severity gate', async () => {
    const { evaluateGate } = await import('@/lib/gates');
    const gate = await makeGate('security', { none: { subject: 'risk', severityAtLeast: 'high' } });

    const spine = new (await import('@/lib/events/spine')).EventSpine(TENANT, ORG);
    await spine.append([
      {
        type: 'RiskFlagged', actorType: 'system', scopeType: 'project', scopeId: PROJECT,
        payload: { scopeType: 'project', scopeId: PROJECT, severity: 'low', description: 'Cosmetic' },
      },
    ]);

    expect((await evaluateGate(gate.id)).passed).toBe(true);
  });

  test('a gate with an unparseable policy holds rather than opening', async () => {
    const { evaluateGate } = await import('@/lib/gates');
    const gate = await db.gate.create({
      data: {
        tenantId: TENANT, orgId: ORG, projectId: PROJECT,
        name: 'legacy', policy: 'no open RiskFlag of severity >= high', state: 'pending',
      },
    });

    const result = await evaluateGate(gate.id);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('no evaluable policy');
    expect((await db.gate.findUnique({ where: { id: gate.id } }))?.state).toBe('pending');
  });

  test('every evaluation is recorded on the spine, so a verdict is auditable', async () => {
    const { evaluateGate } = await import('@/lib/gates');
    const gate = await makeGate('qa', { none: { subject: 'claim', status: ['falsified'] } });
    await evaluateGate(gate.id);

    const events = await db.event.findMany({
      where: { orgId: ORG, type: { in: ['GateEvaluated', 'GatePassed'] } },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['GateEvaluated', 'GatePassed']);
    expect(JSON.parse(events[0].payload as string).policy).toContain('no falsified claim');
  });
});
