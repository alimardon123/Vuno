// What you can do to a message that is already said.
//
// The rules being guarded are the ones that would be invisible if they broke.
// An edit that quietly rewrote the original would pass every screen test and
// destroy the one thing the spine is for. A reaction that could be added twice
// would show "2" from one person. A delete that removed the row would leave a
// reply pointing at nothing.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import {
  editMessage,
  MessageActionError,
  overlayFor,
  pinMessage,
  pinnedIn,
  react,
  redactMessage,
} from '@/lib/messages/actions';
import type { MemberSummary } from '@/lib/members';

const TENANT = 'tnt-act';
const ORG = 'org-act';
const CH = 'ch-act';
const OTHER = 'ch-act-other';

const KAI: MemberSummary = {
  id: 'mbr-act-kai', kind: 'human', displayName: 'Kai', handle: 'act-kai', role: null,
  status: 'active', presenceState: 'available', presenceNote: null, teamId: null,
  ownerMemberId: null, ownerName: null, isOrgOwner: true,
};
const MIRA: MemberSummary = { ...KAI, id: 'mbr-act-mira', displayName: 'Mira', handle: 'act-mira', isOrgOwner: false };

const ctx = { tenantId: TENANT, orgId: ORG, channelId: CH, actor: KAI };
const asMira = { ...ctx, actor: MIRA };

async function post(body: string, by = KAI, channelId = CH): Promise<string> {
  const [e] = await new EventSpine(TENANT, ORG).append([
    {
      type: 'MessagePosted',
      actorType: 'member',
      actorMemberId: by.id,
      scopeType: 'channel',
      scopeId: channelId,
      payload: { body },
    },
  ]);
  return e.id;
}

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'act-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'act-o' } });
  for (const m of [KAI, MIRA]) {
    await db.member.create({
      data: { id: m.id, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: m.displayName, handle: m.handle },
    });
  }
  for (const [id, slug] of [[CH, 'act-room'], [OTHER, 'act-other']]) {
    await db.channel.create({ data: { id, tenantId: TENANT, orgId: ORG, kind: 'channel', name: slug, slug } });
  }
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

describe('reactions', () => {
  test('a reaction is an event, and shows who put it there', async () => {
    const id = await post('the benchmark is back');
    await react(ctx, id, '👍', true);

    const overlay = await overlayFor(ORG, [id], KAI.id);
    const r = overlay.get(id)?.reactions ?? [];
    expect(r).toHaveLength(1);
    expect(r[0].emoji).toBe('👍');
    expect(r[0].by.map((m) => m.displayName)).toEqual(['Kai']);
    expect(r[0].mine).toBe(true);
  });

  test('the same person cannot react twice with the same emoji', async () => {
    const id = await post('hello');
    await react(ctx, id, '👍', true);
    await react(ctx, id, '👍', true);

    const r = (await overlayFor(ORG, [id], KAI.id)).get(id)?.reactions ?? [];
    expect(r[0].by).toHaveLength(1);
    // And nothing was appended the second time — the spine is not a place to
    // record that somebody clicked something that was already on.
    expect(await db.event.count({ where: { orgId: ORG, type: 'ReactionAdded' } })).toBe(1);
  });

  test('two people on the same emoji count as two', async () => {
    const id = await post('hello');
    await react(ctx, id, '🚀', true);
    await react(asMira, id, '🚀', true);

    const r = (await overlayFor(ORG, [id], MIRA.id)).get(id)?.reactions ?? [];
    expect(r[0].by).toHaveLength(2);
    expect(r[0].mine).toBe(true);
  });

  test('taking one back removes it without removing anyone else’s', async () => {
    const id = await post('hello');
    await react(ctx, id, '🚀', true);
    await react(asMira, id, '🚀', true);
    await react(ctx, id, '🚀', false);

    const r = (await overlayFor(ORG, [id], KAI.id)).get(id)?.reactions ?? [];
    expect(r[0].by.map((m) => m.displayName)).toEqual(['Mira']);
    expect(r[0].mine).toBe(false);
  });

  test('an emoji that is not one is refused', async () => {
    const id = await post('hello');
    await expect(react(ctx, id, 'lgtm', true)).rejects.toThrow(/one emoji/);
  });

  test('a message in another conversation cannot be reacted to', async () => {
    const elsewhere = await post('not here', KAI, OTHER);
    await expect(react(ctx, elsewhere, '👍', true)).rejects.toThrow(/not in this conversation/);
  });
});

describe('editing', () => {
  test('the original stays on the spine, exactly as it was posted', async () => {
    const id = await post('p99 is 50ms');
    await editMessage(ctx, id, 'p99 is 142ms');

    const original = await db.event.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(original.payload as string).body).toBe('p99 is 50ms');

    // And the reader sees the correction.
    const overlay = (await overlayFor(ORG, [id], KAI.id)).get(id);
    expect(overlay?.editedBody).toBe('p99 is 142ms');
    expect(overlay?.editedAt).not.toBeNull();
  });

  test('the last edit is the one that shows', async () => {
    const id = await post('one');
    await editMessage(ctx, id, 'two');
    await editMessage(ctx, id, 'three');
    expect((await overlayFor(ORG, [id], KAI.id)).get(id)?.editedBody).toBe('three');
  });

  test('somebody else’s message cannot be edited', async () => {
    const id = await post('mine', MIRA);
    await expect(editMessage(ctx, id, 'not any more')).rejects.toThrow(/who wrote a message/);
  });

  test('an edit that empties a message is refused, and says what to do instead', async () => {
    const id = await post('something');
    await expect(editMessage(ctx, id, '   ')).rejects.toThrow(/delete it instead/);
  });

  test('a record of something that happened is not a message', async () => {
    const [gate] = await new EventSpine(TENANT, ORG).append([
      {
        type: 'GateBlocked',
        actorType: 'member',
        actorMemberId: KAI.id,
        scopeType: 'channel',
        scopeId: CH,
        payload: { gateId: 'g1', name: 'release', reason: 'a falsified claim', blockingRiskIds: [] },
      },
    ]);
    await expect(editMessage(ctx, gate.id, 'nothing to see')).rejects.toThrow(/does not get edited/);
  });
});

describe('deleting', () => {
  test('the row stays, so a reply still has something to point at', async () => {
    const id = await post('never mind');
    await redactMessage(ctx, id);

    expect(await db.event.findUnique({ where: { id } })).not.toBeNull();
    expect((await overlayFor(ORG, [id], KAI.id)).get(id)?.redacted).toBe(true);
  });

  test('somebody else’s message cannot be deleted', async () => {
    const id = await post('mine', MIRA);
    await expect(redactMessage(ctx, id)).rejects.toThrow(MessageActionError);
  });
});

describe('pinning', () => {
  test('a pin is shared, and unpinning takes it off', async () => {
    const id = await post('read this first');
    await pinMessage(ctx, id, true);
    expect((await overlayFor(ORG, [id], KAI.id)).get(id)?.pinned).toBe(true);
    expect((await pinnedIn(ORG, CH)).map((r) => r.id)).toEqual([id]);

    // Anyone in the room can take it down again.
    await pinMessage(asMira, id, false);
    expect((await overlayFor(ORG, [id], KAI.id)).get(id)?.pinned).toBe(false);
    expect(await pinnedIn(ORG, CH)).toEqual([]);
  });
});

describe('the overlay', () => {
  test('asks once for a whole window, not once per message', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => post(t)));
    for (const id of ids) await react(ctx, id, '👍', true);

    const overlay = await overlayFor(ORG, ids, KAI.id);
    expect([...overlay.keys()].sort()).toEqual([...ids].sort());
  });

  test('a message nothing happened to is absent, not an empty object', async () => {
    const id = await post('quiet');
    expect((await overlayFor(ORG, [id], KAI.id)).size).toBe(0);
  });
});
