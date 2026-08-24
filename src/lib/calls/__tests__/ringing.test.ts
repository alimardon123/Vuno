// A DM rings; a channel opens a room.
//
// The rule exists because treating them alike gets one of them wrong. Two
// people in a DM expect the phone to go. A channel with two hundred members
// interrupting all of them because a working group started talking is
// indefensible, and it is the failure this test is here to stop somebody
// reintroducing.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { ringingFor, startOrJoin, leaveCall, styleFor } from '@/lib/calls';
import type { MemberSummary } from '@/lib/members';

const TENANT = 'tnt-ring';
const ORG = 'org-ring';
const DM = 'ch-ring-dm';
const CHANNEL = 'ch-ring-channel';

const KAI: MemberSummary = {
  id: 'mbr-ring-kai', kind: 'human', displayName: 'Kai', handle: 'ring-kai', role: null,
  status: 'active', presenceState: 'available', presenceNote: null, teamId: null,
  ownerMemberId: null, ownerName: null, isOrgOwner: true,
};
const MIRA: MemberSummary = { ...KAI, id: 'mbr-ring-mira', displayName: 'Mira', handle: 'ring-mira', isOrgOwner: false };

const base = { tenantId: TENANT, orgId: ORG };

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'ring-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'ring-o' } });
  for (const m of [KAI, MIRA]) {
    await db.member.create({
      data: { id: m.id, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: m.displayName, handle: m.handle },
    });
  }
  await db.channel.create({
    data: { id: DM, tenantId: TENANT, orgId: ORG, kind: 'dm', name: 'ring-dm', slug: 'ring-dm' },
  });
  await db.channel.create({
    data: { id: CHANNEL, tenantId: TENANT, orgId: ORG, kind: 'channel', name: 'ring-room', slug: 'ring-room' },
  });
  // Both are in the DM. Only membership of a *ringing* kind should ring.
  for (const m of [KAI, MIRA]) {
    for (const channelId of [DM, CHANNEL]) {
      await db.channelMember.create({ data: { ...base, channelId, memberId: m.id } });
    }
  }
});

afterEach(async () => {
  await db.callParticipant.deleteMany({ where: { orgId: ORG } });
  await db.call.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.channelMember.deleteMany({ where: { orgId: ORG } });
  await db.channel.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('which kind of call this is', () => {
  test('follows the room, not the caller', () => {
    expect(styleFor('dm')).toBe('ring');
    expect(styleFor('group')).toBe('ring');
    expect(styleFor('channel')).toBe('room');
    expect(styleFor('team_room')).toBe('room');
  });
});

describe('a call in a DM', () => {
  test('rings the other person, wherever they are', async () => {
    await startOrJoin({ ...base, channelId: DM, actor: KAI });

    const forMira = await ringingFor(ORG, MIRA);
    expect(forMira).toHaveLength(1);
    expect(forMira[0].from).toBe('Kai');
    expect(forMira[0].channelId).toBe(DM);
  });

  test('does not ring the person who started it', async () => {
    await startOrJoin({ ...base, channelId: DM, actor: KAI });
    expect(await ringingFor(ORG, KAI)).toEqual([]);
  });

  test('stops ringing once they are in it', async () => {
    await startOrJoin({ ...base, channelId: DM, actor: KAI });
    await startOrJoin({ ...base, channelId: DM, actor: MIRA });
    expect(await ringingFor(ORG, MIRA)).toEqual([]);
  });

  test('stops when the caller gives up', async () => {
    const { call } = await startOrJoin({ ...base, channelId: DM, actor: KAI });
    await leaveCall({ ...base, callId: call.id, actor: KAI });
    // Nobody is left in it, so it is not a call any more — a browser that
    // crashed does not get to ring somebody forever.
    expect(await ringingFor(ORG, MIRA)).toEqual([]);
  });
});

describe('a call in a channel', () => {
  test('rings nobody, however many members the channel has', async () => {
    await startOrJoin({ ...base, channelId: CHANNEL, actor: KAI });

    expect(await ringingFor(ORG, MIRA)).toEqual([]);
    expect(await ringingFor(ORG, KAI)).toEqual([]);
  });

  test('and a DM call at the same time still rings', async () => {
    await startOrJoin({ ...base, channelId: CHANNEL, actor: KAI });
    await startOrJoin({ ...base, channelId: DM, actor: KAI });

    const forMira = await ringingFor(ORG, MIRA);
    expect(forMira.map((r) => r.channelId)).toEqual([DM]);
  });
});
