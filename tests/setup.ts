// Test bootstrap, preloaded before any test file (see bunfig.toml).
//
// Bun runs every test file in one process, so `@/lib/db`'s client is a single
// module-level singleton bound to whatever DATABASE_URL was set when it was
// first imported. Files that each pointed at their own temp database therefore
// fought over it, and the first file to tear its directory down took the
// others' connection with it ("disk I/O error").
//
// One database for the whole run, created before anything imports Prisma. Test
// files stay isolated by scoping their rows to their own tenant and org, which
// they already did.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vuno-test-'));
const dbFile = join(dir, 'test.db');

process.env.DATABASE_URL = `file:${dbFile}`;

// The migration history, not `db push`: the tests then exercise the same path
// `bun run setup` takes on a real machine, so a migration that does not apply
// fails the test run rather than production.
const proc = Bun.spawn(['bunx', 'prisma', 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
  stdout: 'pipe',
  stderr: 'pipe',
});
if ((await proc.exited) !== 0) {
  throw new Error(
    `Could not apply migrations to the test database:\n${await new Response(proc.stderr).text()}`,
  );
}
