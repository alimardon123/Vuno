// The queue's job is to survive a worker dying mid-run. These tests are the
// evidence for that claim, so they simulate the crash rather than mocking it:
// a worker takes a lease and then simply never comes back.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
// The shared test database is created by tests/setup.ts before any import.
import { db } from '@/lib/db';

const TENANT = 'tnt-q';
const ORG = 'org-q';

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'q-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'q-o' } });
});

afterAll(async () => {
  // Scoped teardown: other test files share this database.
  await db.workSession.deleteMany({ where: { orgId: 'org-q' } });
  await db.workItem.deleteMany({ where: { orgId: 'org-q' } });
  await db.claim.deleteMany({ where: { orgId: 'org-q' } });
  await db.event.deleteMany({ where: { orgId: 'org-q' } });
  await db.membership.deleteMany({ where: { orgId: 'org-q' } });
  await db.objective.deleteMany({ where: { orgId: 'org-q' } });
  await db.member.deleteMany({ where: { orgId: 'org-q' } });
  await db.team.deleteMany({ where: { orgId: 'org-q' } });
  await db.department.deleteMany({ where: { orgId: 'org-q' } });
  await db.organization.deleteMany({ where: { id: 'org-q' } });
  await db.tenant.deleteMany({ where: { id: 'tnt-q' } });
});

beforeEach(async () => {
  await db.workSession.deleteMany({ where: { orgId: 'org-q' } });
  await db.workItem.deleteMany({ where: { orgId: 'org-q' } });
});

const base = { tenantId: TENANT, orgId: ORG, subjectType: 'objective', subjectId: 'obj-1' };

describe('claiming', () => {
  test('an item is claimed exactly once, then is not offered again', async () => {
    const { enqueue, claimNext } = await import('../queue');
    await enqueue({ ...base, kind: 'route_objective' });

    const first = await claimNext({ orgId: ORG, workerId: 'w1' });
    const second = await claimNext({ orgId: ORG, workerId: 'w2' });

    expect(first?.kind).toBe('route_objective');
    expect(second).toBeNull();
  });

  test('twenty workers racing for five items get five items, with no double-claim', async () => {
    const { enqueue, claimNext } = await import('../queue');
    for (let i = 0; i < 5; i++) await enqueue({ ...base, kind: 'propose', subjectId: `obj-${i}` });

    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, i) => claimNext({ orgId: ORG, workerId: `w${i}` })),
    );

    const won = claims.filter((c): c is NonNullable<typeof c> => c !== null);
    expect(won).toHaveLength(5);
    // Each item went to exactly one worker.
    expect(new Set(won.map((w) => w.id)).size).toBe(5);
  });

  test('work scheduled for later is not offered yet', async () => {
    const { enqueue, claimNext } = await import('../queue');
    await enqueue({ ...base, kind: 'later', runAfter: new Date(Date.now() + 60_000) });
    expect(await claimNext({ orgId: ORG, workerId: 'w1' })).toBeNull();
  });

  test('higher priority runs first', async () => {
    const { enqueue, claimNext } = await import('../queue');
    await enqueue({ ...base, kind: 'low', priority: 0 });
    await enqueue({ ...base, kind: 'urgent', priority: 10 });
    const got = await claimNext({ orgId: ORG, workerId: 'w1' });
    expect(got?.kind).toBe('urgent');
  });
});

describe('crash recovery', () => {
  test('a worker that dies mid-run loses its lease and the work is picked up again', async () => {
    const { enqueue, claimNext, LEASE_MS } = await import('../queue');
    await enqueue({ ...base, kind: 'propose' });

    // Worker one takes the item, then the process dies. It never completes,
    // never fails, never heartbeats — it is simply gone.
    const held = await claimNext({ orgId: ORG, workerId: 'worker-that-dies' });
    expect(held).not.toBeNull();

    // While the lease is live nobody else may touch it.
    expect(await claimNext({ orgId: ORG, workerId: 'worker-two' })).toBeNull();

    // Once it expires, the work returns on its own — nothing had to notice.
    const afterExpiry = new Date(Date.now() + LEASE_MS + 1000);
    const recovered = await claimNext({ orgId: ORG, workerId: 'worker-two', now: afterExpiry });

    expect(recovered?.id).toBe(held!.id);
    expect(recovered?.attempts).toBe(2); // the crashed attempt is counted, not lost
  });

  test('a live worker keeps its lease by heartbeating', async () => {
    const { enqueue, claimNext, heartbeat, LEASE_MS } = await import('../queue');
    await enqueue({ ...base, kind: 'slow' });

    const held = await claimNext({ orgId: ORG, workerId: 'w1' });
    expect(await heartbeat(held!.id, 'w1')).toBe(true);

    // Just past the original expiry, the heartbeat has already moved it out.
    const justPast = new Date(Date.now() + LEASE_MS - 500);
    expect(await claimNext({ orgId: ORG, workerId: 'w2', now: justPast })).toBeNull();
  });

  test('a worker cannot heartbeat or complete an item it does not hold', async () => {
    const { enqueue, claimNext, heartbeat, complete } = await import('../queue');
    await enqueue({ ...base, kind: 'propose' });
    const held = await claimNext({ orgId: ORG, workerId: 'w1' });

    expect(await heartbeat(held!.id, 'impostor')).toBe(false);
    expect(await complete(held!.id, 'impostor')).toBe(false);
    // The rightful holder still can.
    expect(await complete(held!.id, 'w1', { ok: true })).toBe(true);
  });
});

describe('failure handling', () => {
  test('a failure retries with backoff, then gives up rather than looping forever', async () => {
    const { enqueue, claimNext, fail } = await import('../queue');
    await enqueue({ ...base, kind: 'flaky', maxAttempts: 2 });

    const first = await claimNext({ orgId: ORG, workerId: 'w1' });
    expect(await fail(first!.id, 'w1', 'boom')).toBe('retry');

    // Backoff means it is not immediately eligible.
    expect(await claimNext({ orgId: ORG, workerId: 'w1' })).toBeNull();

    const later = new Date(Date.now() + 5000);
    const second = await claimNext({ orgId: ORG, workerId: 'w1', now: later });
    expect(second).not.toBeNull();
    expect(await fail(second!.id, 'w1', 'boom again')).toBe('failed');

    const row = await db.workItem.findUnique({ where: { id: first!.id } });
    expect(row?.state).toBe('failed');
    expect(row?.lastError).toContain('boom again');

    // A failed item stays failed — it does not quietly come back.
    const muchLater = new Date(Date.now() + 600_000);
    expect(await claimNext({ orgId: ORG, workerId: 'w1', now: muchLater })).toBeNull();
  });
});

describe('deduplication', () => {
  test('the same step queued twice yields one item', async () => {
    const { enqueue } = await import('../queue');
    const a = await enqueue({ ...base, kind: 'route_objective', dedupeKey: 'route:obj-1' });
    const b = await enqueue({ ...base, kind: 'route_objective', dedupeKey: 'route:obj-1' });

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    expect(await db.workItem.count()).toBe(1);
  });

  test('concurrent enqueues of the same key still yield one item', async () => {
    const { enqueue } = await import('../queue');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        enqueue({ ...base, kind: 'route_objective', dedupeKey: 'race:obj-1' }),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await db.workItem.count()).toBe(1);
  });
});
