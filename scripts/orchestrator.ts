#!/usr/bin/env bun
// The orchestrator process. `bun run orchestrator`, or `bun run dev` starts it
// alongside the app.

import { db } from '../src/lib/db';
import { run } from '../src/lib/orchestrator/runner';

const org = await db.organization.findFirst({
  orderBy: { createdAt: 'asc' },
  select: { id: true, name: true },
});

if (!org) {
  console.error('[orchestrator] No organization found. Run `bun run setup` first.');
  process.exit(1);
}

console.log(`[orchestrator] org: ${org.name}`);
await run({ orgId: org.id });
