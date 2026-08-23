// A message you type yourself came back rendered as "Unknown", and previewed in
// the sidebar as "System" — the composer sends no actor id (there is one
// signed-in member and the server knows who it is), and the route wrote the
// event with `actorMemberId: undefined`.
//
// Attribution is not cosmetic here: the ledger records who made a claim, and
// ADR-0009 says a human and an agent are attributed through the same column. An
// event with no actor is a hole in that record.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';

const TENANT = 'tnt-msg';
const ORG = 'org-msg';
const OWNER = 'mbr-msg-owner';
const AGENT = 'mbr-msg-agent';
const CHANNEL = 'ch-msg';

async function post(body: unknown) {
  const { POST } = await import('../route');
  const res = await POST(
    new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { ok?: boolean; error?: string; event?: { id: string } } };
}

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'msg-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'msg-o' } });
  await db.member.create({
    data: {
      id: OWNER, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Kai Alvarez', handle: 'msg-kai',
      human: { create: { email: 'kai@msg.test', isOrgOwner: true } },
    },
  });
  await db.member.create({
    data: {
      id: AGENT, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Peri', handle: 'msg-peri',
      agent: { create: { role: 'perf' } },
    },
  });
  await db.channel.create({
    data: { id: CHANNEL, tenantId: TENANT, orgId: ORG, kind: 'channel', name: 'msg', slug: 'msg-ch' },
  });
});

afterEach(async () => {
  await db.event.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.channel.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('a posted message names who posted it', () => {
  test('with no actor id, the message is attributed to the signed-in member', async () => {
    const { status, json } = await post({ channelId: CHANNEL, body: 'What did I miss?' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const row = await db.event.findUnique({ where: { id: json.event!.id } });
    expect(row?.actorMemberId).toBe(OWNER);
    expect(row?.actorType).toBe('member');
  });

  test('the sidebar preview names the person, not "System"', async () => {
    await post({ channelId: CHANNEL, body: 'Sent from the composer.' });
    const { listConversations } = await import('@/lib/conversations');
    const c = (await listConversations(ORG, OWNER)).find((x) => x.id === CHANNEL);
    expect(c?.preview?.author).toBe('Kai Alvarez');
  });

  test('the message renders with an author rather than as "Unknown"', async () => {
    await post({ channelId: CHANNEL, body: 'Rendered with a name.' });
    const { listMessages } = await import('@/lib/conversations');
    const [m] = await listMessages(ORG, CHANNEL);
    expect(m.author?.displayName).toBe('Kai Alvarez');
    expect(m.isSystem).toBe(false);
  });

  test('an agent posts under its own id, through the same column (ADR-0009)', async () => {
    const { json } = await post({ channelId: CHANNEL, body: 'Benchmark done.', actorMemberId: AGENT });
    const row = await db.event.findUnique({ where: { id: json.event!.id } });
    expect(row?.actorMemberId).toBe(AGENT);
  });

  test('an assistant acting on your authority records both members', async () => {
    const { json } = await post({
      channelId: CHANNEL,
      body: 'Answering on Kai\'s behalf.',
      actorMemberId: AGENT,
      onBehalfOfMemberId: OWNER,
    });
    const row = await db.event.findUnique({ where: { id: json.event!.id } });
    expect(row?.actorMemberId).toBe(AGENT);
    expect(row?.onBehalfOfMemberId).toBe(OWNER);
  });
});

describe('a message that cannot be attributed is refused, not written unattributed', () => {
  test('an unknown member id is rejected with a message that says so', async () => {
    const { status, json } = await post({ channelId: CHANNEL, body: 'hi', actorMemberId: 'mbr-nobody' });
    expect(status).toBe(400);
    expect(json.error).toContain('Unknown member');
    expect(await db.event.count({ where: { orgId: ORG } })).toBe(0);
  });

  test('a channel outside this org is rejected', async () => {
    const { status, json } = await post({ channelId: 'ch-elsewhere', body: 'hi' });
    expect(status).toBe(400);
    expect(json.error).toContain('Unknown channel');
    expect(await db.event.count({ where: { orgId: ORG } })).toBe(0);
  });

  test('an empty body never reaches the spine', async () => {
    const { status } = await post({ channelId: CHANNEL, body: '' });
    expect(status).toBe(400);
    expect(await db.event.count({ where: { orgId: ORG } })).toBe(0);
  });
});
