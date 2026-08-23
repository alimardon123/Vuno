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
    const kinds = new Map((await listConversations(ORG, KAI)).map((c) => [c.id, c.kind]));

    expect(kinds.get(DM_BOB)).toBe('dm');
    expect(kinds.get(DM_MIRA)).toBe('dm');
    expect(kinds.get(GROUP)).toBe('group');
    expect(kinds.get(ROOM)).toBe('team_room');
    expect(kinds.get(CHANNEL)).toBe('channel');
  });

  test('no DM reaches the Channels pane — the `# Aris` bug cannot recur', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const inChannels = (await listConversations(ORG, KAI)).filter((c) => c.kind === 'channel');
    expect(inChannels.map((c) => c.id)).toEqual([CHANNEL]);
  });

  test('an unrecognised kind is treated as a channel rather than throwing', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const id = 'ch-conv-bogus';
    await db.channel.create({
      data: { id, tenantId: TENANT, orgId: ORG, kind: 'wormhole', name: 'bogus', slug: 'conv-bogus' },
    });
    const found = (await listConversations(ORG, KAI)).find((c) => c.id === id);
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
    const all = await listConversations(ORG, KAI);
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
    const all = await listConversations(ORG, KAI);

    // DM_BOB was posted to last, so it leads; DM_MIRA follows; the rest are silent.
    expect(all[0].id).toBe(DM_BOB);
    expect(all[1].id).toBe(DM_MIRA);
    for (const c of all.slice(2)) expect(c.lastActivityAt).toBeNull();
  });

  test('conversations with no traffic keep a stable alphabetical order', async () => {
    const { listConversations } = await import('@/lib/conversations');
    const silent = (await listConversations(ORG, KAI))
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
