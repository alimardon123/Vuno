// The path an @mention takes: message → work item → orchestrator → adapter →
// validated events on the spine, with what the run cost recorded against it.
//
// This is the bridge ADR-0006 always described and nothing implemented. What
// stood in for it fired inside the HTTP request, replied with hand-written
// text, and recorded no cost — so nobody could see what the organisation spent
// or say why an agent had said anything.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';

const TENANT = 'tnt-turn';
const ORG = 'org-turn';
const KAI = 'mbr-turn-kai';
const BOB = 'mbr-turn-bob';     // Kai's assistant
const SID = 'mbr-turn-sid';     // an independent agent
const CHANNEL = 'ch-turn';

async function post(body: unknown) {
  const { POST } = await import('@/app/api/messages/route');
  const res = await POST(
    new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { ok?: boolean; summoned?: string[]; event?: { id: string } } };
}

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'turn-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'turn-o' } });
  await db.member.create({
    data: {
      id: KAI, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Kai Alvarez', handle: 'turn-kai',
      human: { create: { email: 'kai@turn.test', isOrgOwner: true } },
    },
  });
  await db.member.create({
    data: {
      id: BOB, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Bob', handle: 'bob',
      agent: { create: { role: 'assistant', ownerMemberId: KAI, modelName: 'claude-sonnet-4', harnessName: 'anthropic' } },
    },
  });
  await db.member.create({
    data: {
      id: SID, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Sid', handle: 'sid',
      agent: { create: { role: 'security', modelName: 'claude-sonnet-4', harnessName: 'anthropic' } },
    },
  });
  await db.channel.create({
    data: { id: CHANNEL, tenantId: TENANT, orgId: ORG, kind: 'channel', name: 'turn', slug: 'turn-ch' },
  });
});

afterEach(async () => {
  await db.workSession.deleteMany({ where: { orgId: ORG } });
  await db.workItem.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.claim.deleteMany({ where: { orgId: ORG } });
  await db.channel.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('mentioning an agent queues a turn for it', () => {
  test('a message with no mention queues nothing', async () => {
    const { json } = await post({ channelId: CHANNEL, body: 'Worried about the security of the read path.' });
    expect(json.summoned).toBeUndefined();
    expect(await db.workItem.count({ where: { orgId: ORG } })).toBe(0);
  });

  test('@bob queues one turn, assigned to Bob, in this conversation', async () => {
    const { json } = await post({ channelId: CHANNEL, body: '@bob what did I miss?' });
    expect(json.summoned).toEqual(['bob']);

    const items = await db.workItem.findMany({ where: { orgId: ORG } });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('agent_turn');
    expect(items[0].assigneeId).toBe(BOB);

    const input = JSON.parse(items[0].input) as { scopeId: string; onBehalfOfMemberId?: string; reason: string };
    expect(input.scopeId).toBe(CHANNEL);
    expect(input.reason).toContain('what did I miss');
  });

  test('two mentions queue two turns', async () => {
    await post({ channelId: CHANNEL, body: '@bob @sid — both of you, please' });
    const items = await db.workItem.findMany({ where: { orgId: ORG } });
    expect(items.map((i) => i.assigneeId).sort()).toEqual([BOB, SID].sort());
  });

  test('a repeated request for the same message queues one turn, not two', async () => {
    const { json } = await post({ channelId: CHANNEL, body: '@bob once' });
    const eventId = json.event!.id;

    const { enqueue } = await import('@/lib/orchestrator/queue');
    await enqueue({
      tenantId: TENANT, orgId: ORG, kind: 'agent_turn', subjectType: 'channel', subjectId: CHANNEL,
      assigneeId: BOB, dedupeKey: `mention:${eventId}:${BOB}`, input: {},
    });

    expect(await db.workItem.count({ where: { orgId: ORG } })).toBe(1);
  });

  test('only your own assistant acts on your authority', async () => {
    await post({ channelId: CHANNEL, body: '@bob and @sid, thoughts?' });
    const items = await db.workItem.findMany({ where: { orgId: ORG } });

    const forBob = items.find((i) => i.assigneeId === BOB)!;
    const forSid = items.find((i) => i.assigneeId === SID)!;

    // Bob answers in Kai's name; Sid answers in his own (ADR-0009 §1).
    expect((JSON.parse(forBob.input) as { onBehalfOfMemberId?: string }).onBehalfOfMemberId).toBe(KAI);
    expect((JSON.parse(forSid.input) as { onBehalfOfMemberId?: string }).onBehalfOfMemberId).toBeUndefined();
  });

  test('mentioning a handle nobody has queues nothing', async () => {
    const { json } = await post({ channelId: CHANNEL, body: '@nobody are you there?' });
    expect(json.summoned).toBeUndefined();
    expect(await db.workItem.count({ where: { orgId: ORG } })).toBe(0);
  });

  test('summoning does not change the conversation it happened in', async () => {
    const before = await db.channel.findUnique({ where: { id: CHANNEL } });
    const membersBefore = await db.channelMember.count({ where: { channelId: CHANNEL } });

    await post({ channelId: CHANNEL, body: '@bob a question' });

    const after = await db.channel.findUnique({ where: { id: CHANNEL } });
    // A DM stays a DM: same kind, same name, same membership.
    expect(after!.kind).toBe(before!.kind);
    expect(after!.name).toBe(before!.name);
    expect(await db.channelMember.count({ where: { channelId: CHANNEL } })).toBe(membersBefore);
  });
});

describe('with no model configured, the turn fails in words someone can act on', () => {
  const saved = process.env.ANTHROPIC_API_KEY;

  test('the failure names the variable to set, and does not burn retries', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await post({ channelId: CHANNEL, body: '@bob what did I miss?' });

      const { tick } = await import('@/lib/orchestrator/runner');
      const result = await tick({ orgId: ORG, workerId: 'w-turn' });

      expect(result.handled).toBe(true);
      expect(result.error).toContain('ANTHROPIC_API_KEY');
      expect(result.error).toContain('Bob');

      // Failed for good on the first attempt: no number of retries produces a key.
      const item = await db.workItem.findFirst({ where: { orgId: ORG } });
      expect(item!.state).toBe('failed');
      expect(item!.attempts).toBe(1);

      // And the attempt is on the record with what it cost, which was nothing.
      const session = await db.workSession.findFirst({ where: { orgId: ORG } });
      expect(session!.outcome).toBe('failed');
      expect(session!.error).toContain('ANTHROPIC_API_KEY');

      // Nothing was said on the agent's behalf.
      const posted = await db.event.count({ where: { orgId: ORG, actorMemberId: BOB } });
      expect(posted).toBe(0);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('with a model behind it, an agent turn is a real turn', () => {
  // A stub server standing in for the API, reached over HTTP through
  // ANTHROPIC_BASE_URL. Nothing in the app is special-cased for tests: this is
  // the same path a real key takes.
  let server: ReturnType<typeof Bun.serve> | null = null;
  let lastRequest: Record<string, unknown> = {};
  let reply = '';

  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        lastRequest = (await req.json()) as Record<string, unknown>;
        return Response.json({
          content: [{ type: 'text', text: reply }],
          usage: { input_tokens: 2000, output_tokens: 1000 },
          model: 'claude-sonnet-4-20250514',
        });
      },
    });
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved.base;
  });

  async function runOneTurn(body: string) {
    await post({ channelId: CHANNEL, body });
    const { tick } = await import('@/lib/orchestrator/runner');
    return tick({ orgId: ORG, workerId: 'w-live' });
  }

  test('what the agent says lands on the spine as the agent, on its owner\'s authority', async () => {
    reply = JSON.stringify({
      events: [{ type: 'MessagePosted', payload: { body: 'Three things happened while you were out.' } }],
      claims: [],
    });

    const result = await runOneTurn('@bob what did I miss?');
    expect(result.error).toBeUndefined();

    const posted = await db.event.findFirst({
      where: { orgId: ORG, actorMemberId: BOB, type: 'MessagePosted' },
    });
    expect(posted).not.toBeNull();
    expect(JSON.parse(posted!.payload as string).body).toContain('Three things');
    // Bob posts as Bob, carrying Kai's authority — not as Kai (ADR-0009 §1).
    expect(posted!.actorMemberId).toBe(BOB);
    expect(posted!.onBehalfOfMemberId).toBe(KAI);
    expect(posted!.scopeId).toBe(CHANNEL);
  });

  test('the run is recorded with what it cost', async () => {
    reply = JSON.stringify({ events: [{ type: 'MessagePosted', payload: { body: 'ok' } }], claims: [] });
    await runOneTurn('@bob a question');

    const session = await db.workSession.findFirst({
      where: { orgId: ORG, outcome: 'succeeded' },
      orderBy: { startedAt: 'desc' },
    });
    expect(session!.memberId).toBe(BOB);
    expect(session!.tokensIn).toBe(2000);
    expect(session!.tokensOut).toBe(1000);
    expect(session!.harnessName).toBe('anthropic');
    // 2000 in at $3/M + 1000 out at $15/M = $0.021 → 2 cents.
    expect(session!.costCents).toBe(2);
  });

  test('the agent is shown the conversation it was called into', async () => {
    reply = JSON.stringify({ events: [], claims: [] });
    await post({ channelId: CHANNEL, body: 'The benchmark came back at 142ms.' });
    await runOneTurn('@bob is that bad?');

    const user = String((lastRequest.messages as Array<{ content: string }>)[0].content);
    expect(user).toContain('142ms');
    expect(user).toContain('is that bad?');
  });

  test('a claim it proposes is asserted with the agent as provenance, never born tested', async () => {
    reply = JSON.stringify({
      events: [{ type: 'MessagePosted', payload: { body: 'Enumeration is possible.' } }],
      // A model claiming "tested" is claiming a measurement it did not take.
      claims: [{ statement: 'SSTable offsets allow key enumeration', status: 'tested' }],
    });
    await runOneTurn('@sid look at the read path');

    const claim = await db.claim.findFirst({
      where: { orgId: ORG, statement: { contains: 'enumeration' } },
    });
    expect(claim).not.toBeNull();
    expect(claim!.status).toBe('asserted');
    expect(claim!.provenanceMemberId).toBe(SID);

    await db.claim.deleteMany({ where: { orgId: ORG } });
  });

  test('a turn with nothing to add says so instead of inventing something', async () => {
    reply = JSON.stringify({ events: [], claims: [] });
    const result = await runOneTurn('@bob anything?');

    expect(result.error).toBeUndefined();
    expect(result.summary).toContain('nothing to add');
    expect(await db.event.count({ where: { orgId: ORG, actorMemberId: BOB } })).toBe(0);
  });

  test('prose instead of JSON produces no events, and the reason is on the record', async () => {
    reply = 'Sure! Everything looks fine to me.';
    const result = await runOneTurn('@bob thoughts?');

    expect(await db.event.count({ where: { orgId: ORG, actorMemberId: BOB } })).toBe(0);
    expect(result.summary).toContain('nothing usable');
  });
});
