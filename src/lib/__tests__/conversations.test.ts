// A conversation's kind used to be re-derived in four places from `isDm`, a
// nullable teamId and a slug prefix, which is how `# Aris` ended up in the
// Channels panel. And a DM had a fixed name, which is wrong twice over: it
// named itself after nobody in particular, and the Chats pane could not find
// the assistant's DM without inventing an id for it.
//
// These tests hold the rules the panes now depend on.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';

const TENANT = 'tnt-conv';
const ORG = 'org-conv';

const KAI = 'mbr-conv-kai';
const MIRA = 'mbr-conv-mira';
const BOB = 'mbr-conv-bob';

const DM_BOB = 'ch-conv-dm-bob';
const DM_MIRA = 'ch-conv-dm-mira';
const GROUP = 'ch-conv-group';
const ROOM = 'ch-conv-room';
const CHANNEL = 'ch-conv-channel';
const TEAM = 'team-conv-eng';
const DEPT = 'dept-conv-eng';

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'conv-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'conv-o' } });
  await db.department.create({ data: { id: DEPT, tenantId: TENANT, orgId: ORG, name: 'Engineering', slug: 'conv-eng' } });
  await db.team.create({
    data: { id: TEAM, tenantId: TENANT, orgId: ORG, departmentId: DEPT, name: 'Engineering', slug: 'conv-eng' },
  });

  await db.member.create({
    data: {
      id: KAI, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Kai Alvarez', handle: 'conv-kai',
      human: { create: { email: 'kai@conv.test', isOrgOwner: true } },
    },
  });
  await db.member.create({
    data: {
      id: MIRA, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Mira Okonkwo', handle: 'conv-mira',
      human: { create: { email: 'mira@conv.test' } },
    },
  });
  await db.member.create({
    data: {
      id: BOB, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Bob', handle: 'conv-bob',
      agent: { create: { role: 'assistant', ownerMemberId: KAI } },
    },
  });

  const conv = [
    { id: DM_BOB, kind: 'dm', name: 'Bob', slug: 'conv-dm-bob', teamId: null, people: [KAI, BOB] },
    { id: DM_MIRA, kind: 'dm', name: 'Mira Okonkwo', slug: 'conv-dm-mira', teamId: null, people: [KAI, MIRA] },
    { id: GROUP, kind: 'group', name: 'Launch', slug: 'conv-group', teamId: null, people: [KAI, MIRA, BOB] },
    { id: ROOM, kind: 'team_room', name: 'Engineering', slug: 'conv-room', teamId: TEAM, people: [MIRA] },
    { id: CHANNEL, kind: 'channel', name: 'general', slug: 'conv-channel', teamId: null, people: [KAI, MIRA, BOB] },
  ];
  for (const c of conv) {
    await db.channel.create({
      data: {
        id: c.id, tenantId: TENANT, orgId: ORG, kind: c.kind, name: c.name, slug: c.slug, teamId: c.teamId,
        members: { create: c.people.map((memberId) => ({ tenantId: TENANT, orgId: ORG, memberId })) },
      },
    });
  }

  // Traffic in two of them, so recency ordering has something to order.
  const { EventSpine } = await import('@/lib/events/spine');
  const spine = new EventSpine(TENANT, ORG);
  await spine.append([
    { type: 'MessagePosted', actorType: 'member', actorMemberId: MIRA, scopeType: 'channel', scopeId: DM_MIRA,
      payload: { body: 'Are we still holding the 12th?' } },
  ]);
  await spine.append([
    { type: 'MessagePosted', actorType: 'member', actorMemberId: BOB, scopeType: 'channel', scopeId: DM_BOB,
      payload: { body: 'Three things happened while you were out.' } },
  ]);
});

afterAll(async () => {
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.channelMember.deleteMany({ where: { orgId: ORG } });
  await db.channel.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.team.deleteMany({ where: { orgId: ORG } });
  await db.department.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('a conversation states its kind rather than having it guessed', () => {
  test('each row comes back as the kind it was stored as', async () => {
    const { listConversations } = await import('@/lib/conversations');
    // As the system: Kai is not on the Engineering team, so his own list no
    // longer contains its room — which is the access check working.
    const kinds = new Map((await listConversations(ORG, 'system')).map((c) => [c.id, c.kind]));

    expect(kinds.get(DM_BOB)).toBe('dm');
    expect(kinds.get(DM_MIRA)).toBe('dm');
    expect(kinds.get(GROUP)).toBe('group');
    expect(kinds.get(ROOM)).toBe('team_room');
    expect(kinds.get(CHANNEL)).toBe('channel');
  });

  test('no DM reaches the Channels pane — the `# Aris` bug cannot recur', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const inChannels = (await listConversations(ORG, 'system')).filter((c) => c.kind === 'channel');
    expect(inChannels.map((c) => c.id)).toEqual([CHANNEL]);
  });

  test('an unrecognised kind is treated as a channel rather than throwing', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const id = 'ch-conv-bogus';
    await db.channel.create({
      data: { id, tenantId: TENANT, orgId: ORG, kind: 'wormhole', name: 'bogus', slug: 'conv-bogus' },
    });
    const found = (await listConversations(ORG, 'system')).find((c) => c.id === id);
    expect(found?.kind).toBe('channel');
    await db.channel.deleteMany({ where: { id } });
  });
});

describe('a DM names itself from whoever is reading it', () => {
  test('the same row is "Bob" to Kai and "Kai Alvarez" to Bob', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const toKai = (await listConversations(ORG, KAI)).find((c) => c.id === DM_BOB);
    const toBob = (await listConversations(ORG, BOB)).find((c) => c.id === DM_BOB);

    expect(toKai?.name).toBe('Bob');
    expect(toKai?.counterpart?.id).toBe(BOB);
    expect(toBob?.name).toBe('Kai Alvarez');
    expect(toBob?.counterpart?.id).toBe(KAI);
  });

  test('only a DM has a counterpart; a group chat keeps its own name', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const all = await listConversations(ORG, 'system');
    for (const c of all.filter((x) => x.kind !== 'dm')) {
      expect(c.counterpart).toBeNull();
    }
    expect(all.find((c) => c.id === GROUP)?.name).toBe('Launch');
  });

  test('with no viewer a DM still renders a name instead of an empty string', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const c = (await listConversations(ORG)).find((x) => x.id === DM_BOB);
    expect(c?.name).toBeTruthy();
  });

  test("the assistant's DM is findable by its counterpart, so nothing has to invent an id", async () => {
    const { listConversations } = await import('@/lib/conversations');
    const { getAssistantFor } = await import('@/lib/members');

    const assistant = await getAssistantFor(KAI);
    expect(assistant?.id).toBe(BOB);

    const pinned = (await listConversations(ORG, KAI)).find(
      (c) => c.kind === 'dm' && c.counterpart?.id === assistant?.id,
    );
    expect(pinned?.id).toBe(DM_BOB);
  });
});

describe('the list is ordered like an inbox', () => {
  test('the most recent conversation comes first and silent ones sink', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const all = await listConversations(ORG, 'system');

    // DM_BOB was posted to last, so it leads; DM_MIRA follows; the rest are silent.
    expect(all[0].id).toBe(DM_BOB);
    expect(all[1].id).toBe(DM_MIRA);
    for (const c of all.slice(2)) expect(c.lastActivityAt).toBeNull();
  });

  test('conversations with no traffic keep a stable alphabetical order', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const silent = (await listConversations(ORG, 'system'))
      .filter((c) => c.lastActivityAt === null)
      .map((c) => c.name);
    expect(silent).toEqual([...silent].sort((a, b) => a.localeCompare(b)));
  });
});

describe('participants are rows, not a naming convention', () => {
  test('a group chat carries everyone in it', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const g = (await listConversations(ORG, KAI)).find((c) => c.id === GROUP);
    expect(g?.participants.map((m) => m.id).sort()).toEqual([BOB, KAI, MIRA].sort());
  });

  test('a human and an agent join through the same column (ADR-0009)', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const g = (await listConversations(ORG, KAI)).find((c) => c.id === GROUP);
    expect(g?.participants.map((m) => m.kind).sort()).toEqual(['agent', 'human', 'human']);
  });
});

describe('a long conversation opens at the end, not the beginning', () => {
  const BUSY = 'ch-conv-busy';

  beforeAll(async () => {
    await db.channel.create({
      data: {
        id: BUSY, tenantId: TENANT, orgId: ORG, kind: 'channel', name: 'busy', slug: 'conv-busy',
        members: { create: [{ tenantId: TENANT, orgId: ORG, memberId: KAI }] },
      },
    });
    const { EventSpine } = await import('@/lib/events/spine');
    const spine = new EventSpine(TENANT, ORG);
    // 60 messages against a window of 25 — three windows and a remainder.
    for (let i = 0; i < 60; i += 20) {
      await spine.append(
        Array.from({ length: 20 }, (_, k) => ({
          type: 'MessagePosted' as const,
          actorType: 'member' as const,
          actorMemberId: KAI,
          scopeType: 'channel' as const,
          scopeId: BUSY,
          payload: { body: `message ${i + k + 1}` },
        })),
      );
    }
  });

  test('the newest messages are the ones shown, not the oldest', async () => {
    const { listMessages } = await import('@/lib/conversations');
    const { messages } = await listMessages(ORG, BUSY, 'system', { limit: 25 });

    expect(messages).toHaveLength(25);
    // The bug: `orderBy: seq asc, take: n` returned 1..25 and hid everything after.
    expect(messages[messages.length - 1].body).toBe('message 60');
    expect(messages[0].body).toBe('message 36');
  });

  test('messages within a window still read oldest to newest', async () => {
    const { listMessages } = await import('@/lib/conversations');
    const { messages } = await listMessages(ORG, BUSY, 'system', { limit: 25 });
    const seqs = messages.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  test('the cursor walks back through history and stops at the beginning', async () => {
    const { listMessages } = await import('@/lib/conversations');

    const first = await listMessages(ORG, BUSY, 'system', { limit: 25 });
    expect(first.earlier).not.toBeNull();
    expect(first.isHistory).toBe(false);

    const second = await listMessages(ORG, BUSY, 'system', { limit: 25, before: first.earlier! });
    expect(second.messages[second.messages.length - 1].body).toBe('message 35');
    expect(second.isHistory).toBe(true);

    const third = await listMessages(ORG, BUSY, 'system', { limit: 25, before: second.earlier! });
    expect(third.messages[0].body).toBe('message 1');
    // Nothing precedes the first message, so there is nothing more to offer.
    expect(third.earlier).toBeNull();
  });

  test('walking every window visits each message exactly once', async () => {
    const { listMessages } = await import('@/lib/conversations');
    const seen: string[] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const w = await listMessages(ORG, BUSY, 'system', { limit: 25, before: cursor });
      seen.unshift(...w.messages.map((m) => m.body));
      if (w.earlier === null) break;
      cursor = w.earlier;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen[0]).toBe('message 1');
    expect(seen[59]).toBe('message 60');
  });

  test('the window is bounded however much is asked for — the DOM cannot be flooded', async () => {
    const { listMessages } = await import('@/lib/conversations');
    const { messages } = await listMessages(ORG, BUSY, 'system', { limit: 100_000 });
    expect(messages.length).toBeLessThanOrEqual(500);
  });

  test('a conversation shorter than the window offers no history', async () => {
    const { listMessages } = await import('@/lib/conversations');
    const w = await listMessages(ORG, DM_BOB, 'system', { limit: 25 });
    expect(w.earlier).toBeNull();
    expect(w.isHistory).toBe(false);
  });
});

describe('a conversation is only readable by the people in it', () => {
  // Until there was authentication there was one viewer, so nothing enforced
  // this and any DM was one URL away from anybody who could reach the port.
  const OUTSIDER = 'mbr-conv-outsider';

  beforeAll(async () => {
    await db.member.create({
      data: {
        id: OUTSIDER, tenantId: TENANT, orgId: ORG, kind: 'human',
        displayName: 'Outsider', handle: 'conv-outsider',
        human: { create: { email: 'outsider@conv.test' } },
      },
    });
  });

  test('a channel is the org\'s — every member reads it', async () => {
    const { canRead } = await import('@/lib/conversations');
    const channel = { kind: 'channel' as const, participants: [] };
    expect(canRead(channel, { id: OUTSIDER })).toBe(true);
  });

  test('a DM is its participants\', and nobody else\'s', async () => {
    const { canRead } = await import('@/lib/conversations');
    const dm = {
      kind: 'dm' as const,
      participants: [{ id: KAI }, { id: MIRA }] as never,
    };
    expect(canRead(dm, { id: KAI })).toBe(true);
    expect(canRead(dm, { id: MIRA })).toBe(true);
    expect(canRead(dm, { id: OUTSIDER })).toBe(false);
  });

  test('an assistant reads whatever its owner reads (ADR-0009 §2)', async () => {
    const { canRead } = await import('@/lib/conversations');
    const kaiAndMira = {
      kind: 'dm' as const,
      participants: [{ id: KAI }, { id: MIRA }] as never,
    };

    // Bob is not in it. He reads it because Kai does — asked for explicitly,
    // and what makes an assistant useful rather than a chatbot with amnesia.
    expect(canRead(kaiAndMira, { id: BOB, ownerMemberId: KAI })).toBe(true);
    // An assistant belonging to someone outside it still cannot.
    expect(canRead(kaiAndMira, { id: BOB, ownerMemberId: OUTSIDER })).toBe(false);
  });

  test('nobody signed out reads anything', async () => {
    const { canRead } = await import('@/lib/conversations');
    expect(canRead({ kind: 'channel', participants: [] }, null)).toBe(false);
  });

  test('the list only shows what the viewer can open', async () => {
    const { listConversations } = await import('@/lib/conversations');

    const toKai = (await listConversations(ORG, KAI)).map((c) => c.id);
    expect(toKai).toContain(DM_BOB);
    expect(toKai).toContain(DM_MIRA);

    const toOutsider = (await listConversations(ORG, OUTSIDER)).map((c) => c.id);
    // The channel, yes. Other people's DMs and the group they are not in, no.
    expect(toOutsider).toContain(CHANNEL);
    expect(toOutsider).not.toContain(DM_BOB);
    expect(toOutsider).not.toContain(DM_MIRA);
    expect(toOutsider).not.toContain(GROUP);
  });

  test('a conversation the viewer cannot read comes back as if it is not there', async () => {
    const { getConversation } = await import('@/lib/conversations');
    expect(await getConversation(ORG, DM_MIRA, KAI)).not.toBeNull();
    // Not "forbidden": saying a conversation exists but is closed to you still
    // tells you it exists.
    expect(await getConversation(ORG, DM_MIRA, OUTSIDER)).toBeNull();
  });

  test('an assistant sees its owner\'s DMs in its own list', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const toBob = (await listConversations(ORG, BOB)).map((c) => c.id);

    expect(toBob).toContain(DM_BOB);    // its own
    expect(toBob).toContain(DM_MIRA);   // Kai's, inherited
  });
});

describe('an event can be narrower than the conversation it sits in', () => {
  // `Event.visibility` was written on every row and read on none, so an agent
  // that declared a thought private posted it into the channel for everyone.
  // The column allowed it, the schema documented it, and nothing enforced it.
  const PERI = 'mbr-conv-peri';
  const OUTSIDER2 = 'mbr-conv-outsider2';

  beforeAll(async () => {
    await db.member.create({
      data: {
        id: PERI, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Peri', handle: 'conv-peri',
        agent: { create: { role: 'performance' } },
      },
    });
    await db.member.create({
      data: {
        id: OUTSIDER2, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Dana Reyes', handle: 'conv-dana',
        human: { create: { email: 'dana@conv.test' } },
      },
    });
    await db.channelMember.createMany({
      data: [
        { tenantId: TENANT, orgId: ORG, channelId: CHANNEL, memberId: PERI },
        { tenantId: TENANT, orgId: ORG, channelId: CHANNEL, memberId: OUTSIDER2 },
      ],
    });
    // Mira is on Engineering; Kai and Dana are not.
    await db.membership.create({
      data: { tenantId: TENANT, orgId: ORG, teamId: TEAM, memberId: MIRA, role: 'MEMBER' },
    });

    const { EventSpine } = await import('@/lib/events/spine');
    const spine = new EventSpine(TENANT, ORG);
    await spine.append([
      { type: 'MessagePosted', actorType: 'member', actorMemberId: PERI, scopeType: 'channel', scopeId: CHANNEL,
        payload: { body: 'out loud' } },
      { type: 'AgentThought', actorType: 'member', actorMemberId: PERI, scopeType: 'channel', scopeId: CHANNEL,
        visibility: 'private',
        payload: { thoughtType: 'doubt', content: 'the benchmark may not be representative', topic: 'bench', visibility: 'agent' } },
    ]);
    // Kai's assistant thinks something Kai should be able to read back.
    await spine.append([
      { type: 'AgentThought', actorType: 'member', actorMemberId: BOB, scopeType: 'channel', scopeId: CHANNEL,
        visibility: 'private',
        payload: { thoughtType: 'observation', content: 'Kai has not replied to Mira', topic: 'inbox', visibility: 'agent' } },
    ]);
    // And a note meant for the team that owns the room.
    await spine.append([
      { type: 'MessagePosted', actorType: 'member', actorMemberId: MIRA, scopeType: 'channel', scopeId: ROOM,
        visibility: 'team', payload: { body: 'team only' } },
    ]);
  });

  type Viewer = { id: string; ownerMemberId?: string | null } | 'system';

  /** Everything this viewer can read in one conversation, as plain strings. */
  const bodies = async (channel: string, viewer: Viewer) => {
    const { listMessages } = await import('@/lib/conversations');
    const w = await listMessages(ORG, channel, viewer, { limit: 50 });
    return w.messages.map((m) => m.body || String((m.payload as { content?: string }).content ?? ''));
  };

  test('a private thought is not in anyone else\'s window', async () => {
    expect(await bodies(CHANNEL, { id: OUTSIDER2 })).not.toContain('the benchmark may not be representative');
    // The message it was posted alongside still is — this narrows one event,
    // not the conversation.
    expect(await bodies(CHANNEL, { id: OUTSIDER2 })).toContain('out loud');
  });

  test('its author reads it back', async () => {
    expect(await bodies(CHANNEL, { id: PERI })).toContain('the benchmark may not be representative');
  });

  test('an assistant\'s private thought is its owner\'s to read', async () => {
    // The delegation runs both ways: Kai can audit what Bob concluded before
    // Bob said anything, which is the point of an assistant acting for you.
    expect(await bodies(CHANNEL, { id: KAI })).toContain('Kai has not replied to Mira');
    expect(await bodies(CHANNEL, { id: BOB, ownerMemberId: KAI })).toContain('Kai has not replied to Mira');
    // And stops at the edge of that one identity.
    expect(await bodies(CHANNEL, { id: MIRA })).not.toContain('Kai has not replied to Mira');
  });

  test('a team-visible event reaches the team and stops', async () => {
    expect(await bodies(ROOM, { id: MIRA })).toContain('team only');
    expect(await bodies(ROOM, 'system')).toContain('team only');
    // Kai can open the room only as the system here; as himself he is not on
    // the team, so a team note is not his to read.
    expect(await bodies(ROOM, { id: KAI })).not.toContain('team only');
  });

  test('the window is still exact — filtering happens in the query, not after', async () => {
    // The reason this is a `where` and not a pass over the result: the window
    // asks for `limit + 1` rows to learn whether history precedes it. Dropping
    // hidden rows afterwards would return a short page and, worse, report that
    // nothing came before when something did.
    const { EventSpine } = await import('@/lib/events/spine');
    const { listMessages } = await import('@/lib/conversations');
    const spine = new EventSpine(TENANT, ORG);

    // Two events Dana can see, with two she cannot sitting between them.
    await spine.append([
      { type: 'MessagePosted', actorType: 'member', actorMemberId: PERI, scopeType: 'channel', scopeId: CHANNEL,
        visibility: 'private', payload: { body: 'hidden one' } },
      { type: 'MessagePosted', actorType: 'member', actorMemberId: PERI, scopeType: 'channel', scopeId: CHANNEL,
        visibility: 'private', payload: { body: 'hidden two' } },
      { type: 'MessagePosted', actorType: 'member', actorMemberId: PERI, scopeType: 'channel', scopeId: CHANNEL,
        payload: { body: 'the newest one anybody can see' } },
    ]);

    const w = await listMessages(ORG, CHANNEL, { id: OUTSIDER2 }, { limit: 1 });
    expect(w.messages).toHaveLength(1);
    expect(w.messages[0].body).toBe('the newest one anybody can see');
    // A filter applied after the fact would have taken the newest row plus one
    // hidden row, dropped the hidden one, and had nothing left to say history
    // exists. It does: 'out loud' is behind this.
    expect(w.earlier).not.toBeNull();

    const older = await listMessages(ORG, CHANNEL, { id: OUTSIDER2 }, { limit: 1, before: w.earlier! });
    expect(older.messages[0].body).toBe('out loud');
    expect(older.earlier).toBeNull();
  });

  test('a restricted event says so to the one person reading it', async () => {
    const { listMessages } = await import('@/lib/conversations');
    const w = await listMessages(ORG, CHANNEL, { id: PERI }, { limit: 50 });
    const thought = w.messages.find((m) => m.type === 'AgentThought');
    expect(thought?.restrictedTo).toBe('private');
    expect(w.messages.find((m) => m.body === 'out loud')?.restrictedTo).toBeNull();
  });

  test('a preview never quotes what the reader cannot open', async () => {
    const { EventSpine } = await import('@/lib/events/spine');
    await new EventSpine(TENANT, ORG).append([
      { type: 'MessagePosted', actorType: 'member', actorMemberId: PERI, scopeType: 'channel', scopeId: CHANNEL,
        visibility: 'private', payload: { body: 'a private aside, most recent' } },
    ]);
    const { listConversations } = await import('@/lib/conversations');
    const forDana = (await listConversations(ORG, OUTSIDER2)).find((c) => c.id === CHANNEL);
    expect(forDana?.preview?.body).not.toBe('a private aside, most recent');
    const forPeri = (await listConversations(ORG, PERI)).find((c) => c.id === CHANNEL);
    expect(forPeri?.preview?.body).toBe('a private aside, most recent');
  });
});
