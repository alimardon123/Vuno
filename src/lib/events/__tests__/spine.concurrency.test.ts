// ADR-0008. Event.seq is declared @unique and is the replay ordering key.
// EventSpine.append() reads MAX(seq) and then inserts. Under concurrent agents —
// which is the entire point of the orchestrator — two callers can read the same
// maximum and both try seq = max + 1.
//
// This test reproduces that. It is written to fail against the read-then-insert
// implementation and pass once the database owns the sequence.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vuno-spine-'));
const dbFile = join(dir, 'test.db');

process.env.DATABASE_URL = `file:${dbFile}`;

// Imported after DATABASE_URL is set — the Prisma client reads it at construction.
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } }, log: ['error'] });

const TENANT = 'tnt-test';
const ORG = 'org-test';

beforeAll(async () => {
  const proc = Bun.spawn(
    ['bunx', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    { env: { ...process.env, DATABASE_URL: `file:${dbFile}` }, stdout: 'pipe', stderr: 'pipe' },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`prisma db push failed: ${await new Response(proc.stderr).text()}`);

  await db.tenant.create({ data: { id: TENANT, name: 'Test', slug: 'test' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'Test Org', slug: 'test-org' } });
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
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
            actorType: 'human',
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
