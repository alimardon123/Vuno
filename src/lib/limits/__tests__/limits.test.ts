// One loop posting messages fills the spine, and every mention in one costs a
// model call. The budget caps what the org spends; this caps what one member
// can do to the log itself.

import { beforeEach, describe, expect, test } from 'bun:test';
import { pruneBuckets, resetLimits, takeWrite, WRITE_LIMIT } from '@/lib/limits';

beforeEach(() => resetLimits());

const limit = { max: 3, windowMs: 1000 };

describe('counting writes', () => {
  test('the first writes go through, and report what is left', () => {
    expect(takeWrite('a', limit)).toEqual({ ok: true, remaining: 2, retryAfterSeconds: 0 });
    expect(takeWrite('a', limit)).toEqual({ ok: true, remaining: 1, retryAfterSeconds: 0 });
    expect(takeWrite('a', limit)).toEqual({ ok: true, remaining: 0, retryAfterSeconds: 0 });
  });

  test('one over is refused, and says how long to wait', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) takeWrite('a', limit, now);

    const refused = takeWrite('a', limit, now + 400);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSeconds).toBe(1);
  });

  test('the window resets', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) takeWrite('a', limit, now);
    expect(takeWrite('a', limit, now + 500).ok).toBe(false);
    expect(takeWrite('a', limit, now + 1001).ok).toBe(true);
  });

  test('one member hitting the limit does not stop another', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) takeWrite('kai', limit, now);

    expect(takeWrite('kai', limit, now).ok).toBe(false);
    expect(takeWrite('mira', limit, now).ok).toBe(true);
  });

  test('the shipped limit allows a person typing and stops a loop', () => {
    const now = 1_000_000;
    // Sixty in a minute: nobody types that fast, a loop does it instantly.
    for (let i = 0; i < WRITE_LIMIT.max; i++) {
      expect(takeWrite('kai', WRITE_LIMIT, now).ok).toBe(true);
    }
    expect(takeWrite('kai', WRITE_LIMIT, now).ok).toBe(false);
  });
});

describe('housekeeping', () => {
  test('passed windows are dropped, live ones kept', () => {
    const now = 1_000_000;
    takeWrite('old', limit, now);
    takeWrite('new', limit, now + 900);

    expect(pruneBuckets(now + 1500)).toBe(1);
    // The live one still holds its count.
    expect(takeWrite('new', limit, now + 1500).remaining).toBe(1);
  });
});
