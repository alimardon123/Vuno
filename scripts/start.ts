#!/usr/bin/env bun
// Serve the production build.
//
// `next start` does not work with `output: "standalone"` — Next says so and
// refuses to use the build — and standalone is not optional here: the
// deployment scripts in .zscripts/ look for `.next/standalone/server.js` and
// re-inject the config if it is missing. So `bun run start` runs the standalone
// server directly, after putting the static assets where it expects them.
//
// Next deliberately does not copy `.next/static` or `public` into the
// standalone output — the docs leave that to the deployment step, which is why
// running server.js straight out of a build serves HTML with no CSS.

import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const root = join(import.meta.dir, '..');
const standalone = join(root, '.next', 'standalone');
const server = join(standalone, 'server.js');

if (!existsSync(server)) {
  console.error('\x1b[31m✗ No production build found.\x1b[0m');
  console.error(`  Expected ${server}`);
  console.error('  Build it first:  \x1b[1mbun run build\x1b[0m');
  process.exit(1);
}

for (const [from, to] of [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
]) {
  if (existsSync(from)) await cp(from, to, { recursive: true, force: true });
}

// The server runs from `.next/standalone`, so a DATABASE_URL relative to the
// project would resolve inside the build output and find nothing. Made
// absolute here, where the project root is still known.
function absoluteDatabaseUrl(url: string | undefined): string | undefined {
  if (!url?.startsWith('file:')) return url;
  const path = url.slice('file:'.length);
  if (isAbsolute(path) || path === ':memory:') return url;
  // Written relative to prisma/schema.prisma, so that is what it resolves against.
  return `file:${resolve(root, 'prisma', path)}`;
}

const databaseUrl = absoluteDatabaseUrl(process.env.DATABASE_URL);
if (databaseUrl?.startsWith('file:')) {
  const file = databaseUrl.slice('file:'.length);
  if (!existsSync(file)) {
    console.error(`\x1b[31m✗ No database at\x1b[0m ${file}`);
    console.error('  Create it first:  \x1b[1mbun run setup\x1b[0m');
    process.exit(1);
  }
  console.log(`  Database: ${file}`);
}

// Loopback by default. There is no authentication in this build — whoever
// reaches the port is the org owner, and can post as them, hire, retire and
// change roles. Binding to 0.0.0.0 by default handed that to the network.
// Exposing it is a decision someone has to make on purpose.
const hostname = process.env.HOSTNAME ?? '127.0.0.1';
if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
  console.warn(
    `\x1b[33m⚠ Binding to ${hostname}, and this build has no authentication.\x1b[0m\n` +
      '  Anyone who can reach this port is the org owner. Put it behind something\n' +
      '  that authenticates, or bind to 127.0.0.1.',
  );
}

const proc = Bun.spawn(['bun', server], {
  cwd: standalone,
  stdout: 'inherit',
  stderr: 'inherit',
  env: {
    ...process.env,
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
    NODE_ENV: 'production',
    PORT: process.env.PORT ?? '3000',
    HOSTNAME: hostname,
  },
});
process.on('SIGINT', () => proc.kill());
process.on('SIGTERM', () => proc.kill());
process.exit(await proc.exited);
