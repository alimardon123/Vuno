#!/usr/bin/env bun
// One command, fresh clone, any machine. Creates .env if missing, installs,
// generates the Prisma client, applies the schema, and seeds.
//
// Every step prints what it is doing and, on failure, what to do about it —
// a setup script that fails silently is worse than no setup script.

import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const step = (n: number, of: number, msg: string) =>
  console.log(`\n\x1b[1m[${n}/${of}]\x1b[0m ${msg}`);

async function run(cmd: string[], label: string) {
  const proc = Bun.spawn(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`\n\x1b[31m✗ ${label} failed (exit ${code}).\x1b[0m`);
    console.error(`  Command: ${cmd.join(' ')}`);
    console.error(`  Run it directly to see the full output.`);
    process.exit(code);
  }
}

const TOTAL = 4;

step(1, TOTAL, 'Environment');
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  console.log('  .env already exists — leaving it alone.');
} else {
  await copyFile(join(root, '.env.example'), envPath);
  console.log('  Created .env from .env.example.');
}

step(2, TOTAL, 'Dependencies');
await run(['bun', 'install'], 'bun install');

step(3, TOTAL, 'Database');
await run(['bunx', 'prisma', 'generate'], 'prisma generate');
// `migrate deploy` applies the committed migration history and nothing else.
// This used to be `db push`, which diffs the schema against the database and
// drops whatever no longer matches — fine for a scratch database, and a way to
// lose an org's event spine on the first schema change after it went live.
// `bun run db:push` is still there for iterating on the schema in development.
await run(['bunx', 'prisma', 'migrate', 'deploy'], 'prisma migrate deploy');

step(4, TOTAL, 'Seed');
// `--if-empty`, because seeding clears the database first: running setup again
// on a machine somebody has actually used must not take their org with it.
//
// The decision is made inside the seed's own process, not here. This script
// starts before `bun install` has run, so on a fresh clone Bun has already
// cached `@prisma/client` as unresolvable by the time we would want to ask the
// database anything — which is exactly how the first fresh-clone run failed.
await run(['bun', 'run', 'scripts/seed.ts', '--if-empty'], 'seed');

console.log('\n\x1b[32m✓ Ready.\x1b[0m Start it with:  \x1b[1mbun run dev\x1b[0m\n');
