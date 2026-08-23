// ADR-0008. Event.seq is declared @unique and is the replay ordering key.
// EventSpine.append() reads MAX(seq) and then inserts. Under concurrent agents —
// which is the entire point of the orchestrator — two callers can read the same
// maximum and both try seq = max + 1.
//
// This test reproduces that. It is written to fail against the read-then-insert
// implementation and pass once the database owns the sequence.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
// The shared test database is created by tests/setup.ts before any import.
import { db } from '@/lib/db';

const TENANT = 'tnt-test';
const ORG = 'org-test';

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'Test', slug: 'test' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'Test Org', slug: 'test-org' } });
});

afterAll(async () => {
  // Scoped teardown: other test files share this database.
  await db.workSession.deleteMany({ where: { orgId: 'org-test' } });
  await db.workItem.deleteMany({ where: { orgId: 'org-test' } });
  await db.claim.deleteMany({ where: { orgId: 'org-test' } });
  await db.event.deleteMany({ where: { orgId: 'org-test' } });
  await db.membership.deleteMany({ where: { orgId: 'org-test' } });
  await db.objective.deleteMany({ where: { orgId: 'org-test' } });
  await db.member.deleteMany({ where: { orgId: 'org-test' } });
  await db.team.deleteMany({ where: { orgId: 'org-test' } });
  await db.department.deleteMany({ where: { orgId: 'org-test' } });
  await db.organization.deleteMany({ where: { id: 'org-test' } });
  await db.tenant.deleteMany({ where: { id: 'tnt-test' } });
});

describe('event spine under concurrency', () => {
  test('50 concurrent appends produce 50 distinct, gapless, increasing seq values', async () => {
    const { EventSpine } = await import('../spine');
    const spine = new EventSpine(TENANT, ORG);

    const N = 50;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        spine.append([
          {
            type: 'MessagePosted',
            actorType: 'member',
            scopeType: 'channel',
            scopeId: 'ch-test',
            payload: { body: `concurrent message ${i}` },
          },
        ]),
      ),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    expect(
      failures.map((f) => String((f as PromiseRejectedResult).reason).slice(0, 120)),
    ).toEqual([]);

    const rows = await db.event.findMany({ orderBy: { seq: 'asc' }, select: { seq: true } });
    const seqs = rows.map((r) => r.seq);

    // Every append landed.
    expect(seqs).toHaveLength(N);
    // No duplicates — the unique index would have thrown, but assert intent directly.
    expect(new Set(seqs).size).toBe(N);
    // Strictly increasing with no gaps: replay depends on it.
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => seqs[0] + i));
  }, 60_000);
});
