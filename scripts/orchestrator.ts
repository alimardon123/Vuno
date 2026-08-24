#!/usr/bin/env bun
// The orchestrator process. `bun run orchestrator`, or `bun run dev` starts it
// alongside the app.
//
//   bun run orchestrator                drain the queue and keep watching
//   bun run orchestrator --max-items 5  handle five items and stop
//
// The bounded form is how you watch one thing happen without a process to kill
// afterwards, and how a machine with no model configured can be shown failing
// readably rather than looping.

import { db } from '../src/lib/db';
import { run } from '../src/lib/orchestrator/runner';
import { noHarnessConfiguredMessage } from '../src/lib/agents/registry';

const flag = process.argv.indexOf('--max-items');
const maxItems = flag !== -1 ? Number(process.argv[flag + 1]) : undefined;
if (flag !== -1 && (!Number.isFinite(maxItems) || (maxItems as number) < 1)) {
  console.error('[orchestrator] --max-items needs a positive number.');
  process.exit(1);
}

const org = await db.organization.findFirst({
  orderBy: { createdAt: 'asc' },
  select: { id: true, name: true },
});

if (!org) {
  console.error('[orchestrator] No organization found. Run `bun run setup` first.');
  process.exit(1);
}

console.log(`[orchestrator] org: ${org.name}`);

// Said once at startup rather than discovered one failed work item at a time.
const warning = noHarnessConfiguredMessage();
if (warning) console.warn(`[orchestrator] ${warning}`);

await run({ orgId: org.id, ...(maxItems ? { maxItems } : {}) });
process.exit(0);
