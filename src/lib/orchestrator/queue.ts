// Vuno — the work queue (ADR-0007)
//
// The orchestrator's only durable state. Everything about it exists to survive
// a process that dies mid-run: a worker takes a *lease* rather than a lock, and
// a lease expires on its own. Nothing has to notice the crash.
//
// Claiming is a compare-and-swap, not a read-then-write. `updateMany` with the
// precondition in the WHERE clause is atomic in SQLite, so two workers racing
// for the same item produce one winner and one `count === 0` — the same mistake
// the event spine used to make, not repeated here.

import { db } from '@/lib/db';

/** How long a worker may hold an item before the lease is up for grabs. */
export const LEASE_MS = 30_000;

export type WorkItemState = 'pending' | 'leased' | 'done' | 'failed' | 'cancelled';

export interface EnqueueInput {
  tenantId: string;
  orgId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  objectiveId?: string | null;
  assigneeId?: string | null;
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
  /**
   * Names a step that should run once, ever. Enqueueing it again returns the
   * existing item. A step that legitimately repeats (round two of a debate)
   * carries a discriminator in the key rather than reusing it.
   */
  dedupeKey?: string | null;
  input?: unknown;
}

export interface LeasedItem {
  id: string;
  tenantId: string;
  orgId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  objectiveId: string | null;
  assigneeId: string | null;
  attempts: number;
  maxAttempts: number;
  input: unknown;
}

/**
 * Add work. Returns the existing item when `dedupeKey` already names an
 * unfinished one — enqueueing the same step twice is a no-op, not an error,
 * because callers legitimately race (a webhook and a poll can both notice the
 * same thing).
 */
export async function enqueue(item: EnqueueInput): Promise<{ id: string; created: boolean }> {
  const data = {
    tenantId: item.tenantId,
    orgId: item.orgId,
    kind: item.kind,
    subjectType: item.subjectType,
    subjectId: item.subjectId,
    objectiveId: item.objectiveId ?? null,
    assigneeId: item.assigneeId ?? null,
    priority: item.priority ?? 0,
    runAfter: item.runAfter ?? new Date(),
    maxAttempts: item.maxAttempts ?? 3,
    dedupeKey: item.dedupeKey ?? null,
    input: JSON.stringify(item.input ?? {}),
  };

  if (!item.dedupeKey) {
    const created = await db.workItem.create({ data, select: { id: true } });
    return { id: created.id, created: true };
  }

  // Deriving the id from the dedupe key makes this an upsert on the primary
  // key: concurrent callers converge on one row without anyone throwing. The
  // earlier version raced on the unique index and relied on catching the
  // violation, which worked but logged a constraint error on a normal path.
  const id = `wi_${item.orgId}_${item.dedupeKey}`;
  const before = await db.workItem.findUnique({ where: { id }, select: { id: true } });
  await db.workItem.upsert({ where: { id }, create: { ...data, id }, update: {} });
  return { id, created: before === null };
}

/**
 * Take the next eligible item, or null. Eligible means: pending and due, or
 * leased with an expired lease — a crashed worker's item comes back on its own.
 *
 * The claim is a conditional update. If another worker got there first the
 * update matches nothing and we move to the next candidate.
 */
export async function claimNext(opts: {
  orgId: string;
  workerId: string;
  kinds?: string[];
  now?: Date;
}): Promise<LeasedItem | null> {
  const now = opts.now ?? new Date();

  const candidates = await db.workItem.findMany({
    where: {
      orgId: opts.orgId,
      ...(opts.kinds?.length ? { kind: { in: opts.kinds } } : {}),
      runAfter: { lte: now },
      OR: [
        { state: 'pending' },
        // Reclaiming an expired lease is how crash recovery happens.
        { state: 'leased', leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: [{ priority: 'desc' }, { runAfter: 'asc' }, { createdAt: 'asc' }],
    take: 10,
    select: { id: true, state: true },
  });

  for (const candidate of candidates) {
    const claimed = await db.workItem.updateMany({
      where: {
        id: candidate.id,
        // The precondition. Two workers cannot both satisfy it.
        OR: [
          { state: 'pending' },
          { state: 'leased', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        state: 'leased',
        leasedBy: opts.workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attempts: { increment: 1 },
        startedAt: now,
      },
    });
    if (claimed.count !== 1) continue; // lost the race, try the next one

    const row = await db.workItem.findUnique({ where: { id: candidate.id } });
    if (!row) continue;
    return {
      id: row.id,
      tenantId: row.tenantId,
      orgId: row.orgId,
      kind: row.kind,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      objectiveId: row.objectiveId,
      assigneeId: row.assigneeId,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      input: safeParse(row.input),
    };
  }

  return null;
}

/** Extend a lease on work that is legitimately taking a while. */
export async function heartbeat(itemId: string, workerId: string): Promise<boolean> {
  const updated = await db.workItem.updateMany({
    where: { id: itemId, leasedBy: workerId, state: 'leased' },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return updated.count === 1;
}

export async function complete(itemId: string, workerId: string, result?: unknown): Promise<boolean> {
  const updated = await db.workItem.updateMany({
    where: { id: itemId, leasedBy: workerId, state: 'leased' },
    data: {
      state: 'done',
      result: JSON.stringify(result ?? {}),
      finishedAt: new Date(),
      leasedBy: null,
      leaseExpiresAt: null,
    },
  });
  return updated.count === 1;
}

/**
 * Record a failure. Retries with backoff until `maxAttempts`, then the item
 * fails for good — it never loops forever, which is the whole point of
 * bounding attempts (ADR-0007).
 */
export async function fail(itemId: string, workerId: string, error: string): Promise<'retry' | 'failed'> {
  const row = await db.workItem.findUnique({
    where: { id: itemId },
    select: { attempts: true, maxAttempts: true },
  });
  if (!row) return 'failed';

  const exhausted = row.attempts >= row.maxAttempts;
  const backoffMs = Math.min(2 ** row.attempts * 1000, 60_000);

  await db.workItem.updateMany({
    where: { id: itemId, leasedBy: workerId },
    data: exhausted
      ? {
          state: 'failed',
          lastError: error.slice(0, 2000),
          finishedAt: new Date(),
          leasedBy: null,
          leaseExpiresAt: null,
        }
      : {
          state: 'pending',
          lastError: error.slice(0, 2000),
          runAfter: new Date(Date.now() + backoffMs),
          leasedBy: null,
          leaseExpiresAt: null,
        },
  });

  return exhausted ? 'failed' : 'retry';
}

export async function pendingCount(orgId: string): Promise<number> {
  return db.workItem.count({ where: { orgId, state: { in: ['pending', 'leased'] } } });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
