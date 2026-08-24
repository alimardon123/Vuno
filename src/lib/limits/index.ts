// Vuno — how often one member may write.
//
// One loop posting messages fills the spine, and every mention in one costs a
// model call. The budget caps what the org spends; this caps what one member
// can do to the log itself.
//
// In memory, per process, deliberately. A durable counter would be another
// table on the write path of every message, and this is a local-first app with
// one server — the limit exists to stop a runaway script and a stuck retry
// loop, not to survive an adversary with a botnet. When there is more than one
// server there will be somewhere shared to put it, and it will be obvious.

export interface Limit {
  /** How many writes are allowed in the window. */
  max: number;
  /** How long the window is, in milliseconds. */
  windowMs: number;
}

/** Generous for a person typing, tight enough to stop a loop. */
export const WRITE_LIMIT: Limit = { max: 60, windowMs: 60_000 };

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface LimitResult {
  ok: boolean;
  /** Writes left in this window. */
  remaining: number;
  /** Seconds until the window resets — what a Retry-After header carries. */
  retryAfterSeconds: number;
}

/**
 * Count one write against `key`, and say whether it is allowed.
 *
 * The key is the member, not the connection: rate-limiting by IP punishes
 * everyone behind one office router and does nothing to a script running
 * locally, which is the case this actually guards.
 */
export function takeWrite(key: string, limit: Limit = WRITE_LIMIT, now = Date.now()): LimitResult {
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { ok: true, remaining: limit.max - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit.max) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit.max - bucket.count, retryAfterSeconds: 0 };
}

/** Drop windows that have passed. Called opportunistically, not on a timer. */
export function pruneBuckets(now = Date.now()): number {
  let removed = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Tests only: start from nothing. */
export function resetLimits(): void {
  buckets.clear();
}
