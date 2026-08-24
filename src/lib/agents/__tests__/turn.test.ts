// The path an @mention takes: message → work item → orchestrator → adapter →
// validated events on the spine, with what the run cost recorded against it.
//
// This is the bridge ADR-0006 always described and nothing implemented. What
// stood in for it fired inside the HTTP request, replied with hand-written
// text, and recorded no cost — so nobody could see what the organisation spent
// or say why an agent had said anything.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { clearSessions, signedInAs } from '../../../../tests/session';

const TENANT = 'tnt-turn';
const ORG = 'org-turn';
const KAI = 'mbr-turn-kai';
const BOB = 'mbr-turn-bob';     // Kai's assistant
const SID = 'mbr-turn-sid';     // an independent agent
const CHANNEL = 'ch-turn';

let session: { header: { Cookie: string } };

async function post(body: unknown) {
  const { POST } = await import('@/app/api/messages/route');
  const res = await POST(
    new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...session.header },
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
  session = await signedInAs(KAI);
});

afterEach(async () => {
  await db.workSession.deleteMany({ where: { orgId: ORG } });
  await db.workItem.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await clearSessions();
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

describe('a message cannot summon the whole org', () => {
  test('at most three agents are queued from one message', async () => {
    // Every mention is a model call somebody pays for; a pasted list of handles
    // should not be able to spend a budget.
    await post({ channelId: CHANNEL, body: '@bob @sid @bob @sid @nobody @bob please' });
    const items = await db.workItem.findMany({ where: { orgId: ORG } });
    expect(items.length).toBeLessThanOrEqual(3);
  });
});

describe('an agent calling a tool it holds', () => {
  // Two real servers and no mocks: a stub model over HTTP (the same path a key
  // takes) and the reference MCP server over HTTP. What is being tested is the
  // join between them — that a call the model asks for is actually made, that
  // the answer comes back to the model, and that the org can see afterwards
  // what its agent did outside it.
  let model: ReturnType<typeof Bun.serve> | null = null;
  let mcp: Awaited<ReturnType<typeof import('@/lib/connections/__tests__/server')['startMcpServer']>>;
  let replies: string[] = [];
  const prompts: Array<{ system: string; user: string }> = [];

  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };

  beforeAll(async () => {
    const { startMcpServer } = await import('@/lib/connections/__tests__/server');
    mcp = await startMcpServer();

    model = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { system: string; messages: Array<{ content: string }> };
        prompts.push({ system: body.system, user: String(body.messages[0].content) });
        return Response.json({
          content: [{ type: 'text', text: replies.shift() ?? JSON.stringify({ events: [], claims: [] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-sonnet-4-20250514',
        });
      },
    });
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${model.port}`;

    const { createConnection, checkConnection, setConnectionHolder } = await import('@/lib/connections');
    const { id } = await createConnection({
      tenantId: TENANT, orgId: ORG, key: 'obs', name: 'Observability',
      summary: 'Metrics for the services this org runs.', url: mcp.url,
    });
    // Discovery is a real round trip to a real server.
    const checked = await checkConnection(ORG, id);
    expect(checked.lastError).toBeNull();
    expect(checked.tools.map((t) => t.name).sort()).toEqual(['deploy', 'p99_latency']);

    await setConnectionHolder({ orgId: ORG, connectionId: id, memberId: BOB, held: true });
  });

  afterAll(async () => {
    model?.stop(true);
    await mcp.stop();
    await db.memberConnection.deleteMany({ where: { orgId: ORG } });
    await db.connection.deleteMany({ where: { orgId: ORG } });
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved.base;
  });

  async function runOneTurn(body: string) {
    prompts.length = 0;
    await post({ channelId: CHANNEL, body });
    const { tick } = await import('@/lib/orchestrator/runner');
    return tick({ orgId: ORG, workerId: 'w-tools' });
  }

  test('the agent is told what it can reach, with the argument schema', async () => {
    replies = [JSON.stringify({ events: [], claims: [] })];
    await runOneTurn('@bob anything?');

    const system = prompts[0].system;
    expect(system).toContain('obs/p99_latency');
    expect(system).toContain('p99 read latency');
    // Without the schema the model has to guess argument names, and finds out
    // it guessed wrong by spending a round trip.
    expect(system).toContain('"service"');
  });

  test('an agent that holds nothing is told about nothing', async () => {
    replies = [JSON.stringify({ events: [], claims: [] })];
    await runOneTurn('@sid thoughts?');
    expect(prompts[0].system).not.toContain('obs/p99_latency');
  });

  test('a call the agent asks for is actually made, and the answer reaches it', async () => {
    replies = [
      JSON.stringify({ toolCalls: [{ connection: 'obs', tool: 'p99_latency', arguments: { service: 'storage-engine', windowHours: 12 } }] }),
      JSON.stringify({
        events: [{ type: 'MessagePosted', payload: { body: 'p99 is 142ms over the last 12h, measured just now via obs/p99_latency.' } }],
        claims: [],
      }),
    ];

    const before = mcp.calls.length;
    const result = await runOneTurn('@bob what is the p99 right now?');
    expect(result.error).toBeUndefined();

    // The server really ran it, with the arguments the model asked for.
    expect(mcp.calls.slice(before)).toEqual([
      { tool: 'p99_latency', args: { service: 'storage-engine', windowHours: 12 } },
    ]);

    // And the result came back into the second prompt, which is the whole
    // point: a tool whose answer the model never sees is a tool nobody called.
    expect(prompts).toHaveLength(2);
    expect(prompts[1].user).toContain('p99 142ms over 12h');

    const posted = await db.event.findFirst({ where: { orgId: ORG, actorMemberId: BOB, type: 'MessagePosted' } });
    expect(JSON.parse(posted!.payload as string).body).toContain('142ms');
  });

  test('the call is on the spine, so the org can see what its agent did outside it', async () => {
    replies = [
      JSON.stringify({ toolCalls: [{ connection: 'obs', tool: 'p99_latency', arguments: { service: 'api' } }] }),
      JSON.stringify({ events: [{ type: 'MessagePosted', payload: { body: 'api is fine.' } }], claims: [] }),
    ];
    await runOneTurn('@bob check api');

    const called = await db.event.findFirst({ where: { orgId: ORG, type: 'ToolCalled' } });
    expect(called).not.toBeNull();
    const payload = JSON.parse(called!.payload as string) as Record<string, unknown>;
    expect(payload.connectionKey).toBe('obs');
    expect(payload.tool).toBe('p99_latency');
    expect(payload.arguments).toEqual({ service: 'api' });
    expect(payload.result).toContain('142ms');
    expect(payload.failed).toBe(false);
    // Attributed to the agent that made it, on its owner's authority.
    expect(called!.actorMemberId).toBe(BOB);
    expect(called!.onBehalfOfMemberId).toBe(KAI);
    // And it sits before what the agent said about it.
    const said = await db.event.findFirst({ where: { orgId: ORG, actorMemberId: BOB, type: 'MessagePosted' } });
    expect(called!.seq).toBeLessThan(said!.seq);
  });

  test('a connection the agent does not hold is refused by naming what it does hold', async () => {
    replies = [
      JSON.stringify({ toolCalls: [{ connection: 'production-db', tool: 'drop_table', arguments: {} }] }),
      JSON.stringify({ events: [{ type: 'MessagePosted', payload: { body: 'I cannot reach that.' } }], claims: [] }),
    ];
    const before = mcp.calls.length;
    await runOneTurn('@bob drop the table');

    // Nothing was dialled.
    expect(mcp.calls.length).toBe(before);
    // And the agent was told why, in terms it can act on — a call that just
    // vanishes is a call the agent asks for again.
    expect(prompts[1].user).toContain('do not hold a connection called "production-db"');
    expect(prompts[1].user).toContain('You hold: obs');
    // A refused call is not a call, so nothing claims one happened.
    expect(await db.event.count({ where: { orgId: ORG, type: 'ToolCalled' } })).toBe(0);
  });

  test('a tool that fails comes back as something the agent can correct', async () => {
    replies = [
      JSON.stringify({ toolCalls: [{ connection: 'obs', tool: 'deploy', arguments: { service: 'storage-engine' } }] }),
      JSON.stringify({ events: [{ type: 'MessagePosted', payload: { body: 'Deploy is blocked behind the release gate.' } }], claims: [] }),
    ];
    await runOneTurn('@bob ship it');

    expect(prompts[1].user).toContain('FAILED');
    expect(prompts[1].user).toContain('blocked release gate');

    const called = await db.event.findFirst({ where: { orgId: ORG, type: 'ToolCalled' } });
    expect(JSON.parse(called!.payload as string).failed).toBe(true);
  });

  test('a model that only ever asks for tools is stopped', async () => {
    // Every pass is another call somebody pays for. Without a bound, a model
    // that keeps asking spends the budget rather than answering.
    replies = Array.from({ length: 8 }, () =>
      JSON.stringify({ toolCalls: [{ connection: 'obs', tool: 'p99_latency', arguments: { service: 'x' } }] }),
    );
    const before = mcp.calls.length;
    await runOneTurn('@bob loop please');

    // Exactly: one opening call to the model, then two passes, each of which
    // runs the one call it asked for and goes back once more.
    expect(prompts).toHaveLength(3);
    expect(mcp.calls.length - before).toBe(2);
  });

  test('what the turn cost is what the turn spent, not what its last pass spent', async () => {
    replies = [
      JSON.stringify({ toolCalls: [{ connection: 'obs', tool: 'p99_latency', arguments: { service: 'a' } }] }),
      JSON.stringify({ events: [{ type: 'MessagePosted', payload: { body: 'done' } }], claims: [] }),
    ];
    await runOneTurn('@bob one call please');

    const ws = await db.workSession.findFirst({
      where: { orgId: ORG, outcome: 'succeeded' },
      orderBy: { startedAt: 'desc' },
    });
    // Two passes at 100 in / 50 out each.
    expect(ws!.tokensIn).toBe(200);
    expect(ws!.tokensOut).toBe(100);
  });
});
