#!/usr/bin/env bun
// Seeds via the same function the app's /api/seed route uses, so the seed
// cannot drift from what the running app produces.

import { seedDatabase } from '../src/lib/seed/seed';

const result = await seedDatabase();
console.log(`  ${result.message}`);
process.exit(result.ok ? 0 : 1);
