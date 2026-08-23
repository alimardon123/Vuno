#!/usr/bin/env bun
// Seeds via the same function the app's /api/seed route uses, so the seed
// cannot drift from what the running app produces.
//
//   bun run scripts/seed.ts             replace whatever is there
//   bun run scripts/seed.ts --if-empty  fill an empty database, leave a used one
//
// Seeding clears the database first, so `--if-empty` is what `bun run setup`
// uses: running setup a second time on a machine somebody has actually used
// must not take their org and its event spine with it.

import { db } from '../src/lib/db';
import { seedDatabase } from '../src/lib/seed/seed';

if (process.argv.includes('--if-empty')) {
  const existing = await db.organization.count();
  if (existing > 0) {
    console.log(`  Database already holds ${existing} organisation${existing === 1 ? '' : 's'} — leaving it alone.`);
    console.log('  To replace it with the sample org: \x1b[1mbun run seed\x1b[0m');
    process.exit(0);
  }
}

const result = await seedDatabase();
console.log(`  ${result.message}`);
process.exit(result.ok ? 0 : 1);
