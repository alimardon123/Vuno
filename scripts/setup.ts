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
await run(['bunx', 'prisma', 'db', 'push', '--skip-generate'], 'prisma db push');

step(4, TOTAL, 'Seed');
await run(['bun', 'run', 'scripts/seed.ts'], 'seed');

console.log('\n\x1b[32m✓ Ready.\x1b[0m Start it with:  \x1b[1mbun run dev\x1b[0m\n');
