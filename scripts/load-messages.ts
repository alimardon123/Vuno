// Seed a conversation with a lot of messages, to measure against rather than
// to guess. The Performant principle says 60 fps at 5,000 messages; this is
// how that claim gets tested.
//
//   bun run scripts/load-messages.ts [count] [channelId]

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { NewEventInput } from '@/lib/events/types';

const count = Number(process.argv[2] ?? 5000);
const channelId = process.argv[3] ?? 'ch-storage';

const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } });
if (!org) throw new Error('No organisation. Run `bun run setup` first.');

const channel = await db.channel.findFirst({ where: { id: channelId, orgId: org.id } });
if (!channel) throw new Error(`No channel ${channelId} in this org.`);

const members = await db.member.findMany({ where: { orgId: org.id }, select: { id: true } });
if (members.length === 0) throw new Error('No members to attribute messages to.');

const LINES = [
  'Re-ran it on a clean box; the spread was under 4ms, so it is the design and not the run.',
  'That contradicts the memory model we agreed on last week. Where is the working set going?',
  'Attaching the flame graph. SSTable reads dominate everything above p90.',
  'I can have a measurement by Thursday if nobody needs the box before then.',
  'Blocked on the benchmark, not on a person — I would rather wait than guess.',
  'Correction on my last: the 1.5x figure was at 10M keys, not 1M.',
  'If this holds we should say so on the ledger rather than in a thread.',
];

const spine = new EventSpine(org.tenantId, org.id);
const start = Date.now();
const BATCH = 250;

for (let i = 0; i < count; i += BATCH) {
  const n = Math.min(BATCH, count - i);
  const batch: NewEventInput[] = Array.from({ length: n }, (_, k) => {
    const idx = i + k;
    return {
      type: 'MessagePosted' as const,
      actorType: 'member' as const,
      actorMemberId: members[idx % members.length].id,
      scopeType: 'channel' as const,
      scopeId: channelId,
      payload: { body: `${LINES[idx % LINES.length]} (#${idx + 1})` },
      // Spread backwards from now so the day dividers are exercised too.
      occurredAt: new Date(Date.now() - (count - idx) * 30_000),
    };
  });
  await spine.append(batch);
  if ((i / BATCH) % 4 === 0) process.stdout.write('.');
}

const seconds = ((Date.now() - start) / 1000).toFixed(1);
const total = await db.event.count({ where: { orgId: org.id, scopeId: channelId, type: 'MessagePosted' } });
console.log(`\n  ${count} messages appended in ${seconds}s — #${channel.name} now holds ${total}.`);
