// A channel reads as posts; a chat reads as a stream.
//
// The same events, read two ways. What matters is that the threaded read never
// loses a reply and never shows one twice — a reply that appears both under its
// post and as a post of its own is the failure mode, and it is invisible until
// somebody scrolls.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { listMessages, modeFor } from '@/lib/conversations';

const TENANT = 'tnt-thread';
const ORG = 'org-thread';
const CHANNEL = 'ch-thread-room';
const DM = 'ch-thread-dm';
const KAI = 'mbr-thread-kai';
const MIRA = 'mbr-thread-mira';

const viewer = { id: KAI, ownerMemberId: null };
const spine = () => new EventSpine(TENANT, ORG);

async function post(scopeId: string, body: string, by = KAI): Promise<string> {
  const [e] = await spine().append([
    { type: 'MessagePosted', actorType: 'member', actorMemberId: by, scopeType: 'channel', scopeId, payload: { body } },
  ]);
  return e.id;
}

async function reply(scopeId: string, parentId: string, body: string, by = MIRA): Promise<string> {
  const [e] = await spine().append([
    {
      type: 'ThreadReplyPosted',
      actorType: 'member',
      actorMemberId: by,
      scopeType: 'channel',
      scopeId,
      payload: { body, parentId },
    },
  ]);
  return e.id;
}

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'thread-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'thread-o' } });
  for (const [id, name, handle] of [
    [KAI, 'Kai', 'thread-kai'],
    [MIRA, 'Mira', 'thread-mira'],
  ]) {
    await db.member.create({
      data: { id, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: name, handle },
    });
  }
  await db.channel.create({
    data: { id: CHANNEL, tenantId: TENANT, orgId: ORG, kind: 'channel', name: 'thread-room', slug: 'thread-room' },
  });
  await db.channel.create({
    data: { id: DM, tenantId: TENANT, orgId: ORG, kind: 'dm', name: 'thread-dm', slug: 'thread-dm' },
  });
  for (const memberId of [KAI, MIRA]) {
    await db.channelMember.create({ data: { tenantId: TENANT, orgId: ORG, channelId: DM, memberId } });
  }
});

afterAll(async () => {
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.channelMember.deleteMany({ where: { orgId: ORG } });
  await db.channel.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('which way a conversation reads', () => {
  test('a channel and a team room are threaded; a DM and a group are not', () => {
    expect(modeFor('channel')).toBe('threaded');
    expect(modeFor('team_room')).toBe('threaded');
    expect(modeFor('dm')).toBe('flat');
    expect(modeFor('group')).toBe('flat');
  });
});

describe('a channel', () => {
  test('shows posts, with replies under the post they answer', async () => {
    const first = await post(CHANNEL, 'the benchmark is back');
    await reply(CHANNEL, first, 'what was the target?');
    await reply(CHANNEL, first, '50ms');
    const second = await post(CHANNEL, 'unrelated: the deploy is out');

    const w = await listMessages(ORG, CHANNEL, viewer, { mode: 'threaded' });

    // Two posts in the stream, not four lines.
    expect(w.messages.map((m) => m.id)).toEqual([first, second]);
    expect(w.messages[0].replies.map((r) => r.body)).toEqual(['what was the target?', '50ms']);
    expect(w.messages[0].replyCount).toBe(2);
    expect(w.messages[1].replyCount).toBe(0);
  });

  test('a reply is never also a post — nothing is shown twice', async () => {
    const w = await listMessages(ORG, CHANNEL, viewer, { mode: 'threaded' });
    const replyIds = new Set(w.messages.flatMap((m) => m.replies.map((r) => r.id)));
    for (const m of w.messages) expect(replyIds.has(m.id)).toBe(false);
  });

  test('a reply inside a thread does not quote its own post', async () => {
    const w = await listMessages(ORG, CHANNEL, viewer, { mode: 'threaded' });
    // The post is the line above it; quoting would say the same thing twice.
    for (const r of w.messages[0].replies) expect(r.replyTo).toBeNull();
  });

  test('the window counts posts, so a busy thread cannot crowd one out', async () => {
    const noisy = await post(CHANNEL, 'a thread with a lot in it');
    for (let i = 0; i < 40; i += 1) await reply(CHANNEL, noisy, `reply ${i}`);

    const w = await listMessages(ORG, CHANNEL, viewer, { mode: 'threaded', limit: 2 });
    expect(w.messages).toHaveLength(2);

    const loaded = w.messages.find((m) => m.id === noisy);
    expect(loaded?.replyCount).toBe(40);
    // Bounded: the count is the truth, the loaded replies are a preview.
    expect(loaded!.replies.length).toBeLessThan(40);
    // And it is the *latest* replies that are kept — the end of a conversation
    // is the part somebody arriving needs.
    expect(loaded!.replies.at(-1)?.body).toBe('reply 39');
  });
});

describe('a chat', () => {
  test('is one stream, and a reply stays in it', async () => {
    const first = await post(DM, 'are we still on for 3?');
    await reply(DM, first, 'yes');

    const w = await listMessages(ORG, DM, viewer, { mode: 'flat' });

    expect(w.messages.map((m) => m.body)).toEqual(['are we still on for 3?', 'yes']);
    expect(w.mode).toBe('flat');
    // It quotes what it answers, because in a flat stream the thing it answers
    // may be a long way up.
    expect(w.messages[1].replyTo?.id).toBe(first);
    expect(w.messages[1].replyTo?.author).toBe('Kai');
  });

  test('carries no threads, so the view has nothing to indent', async () => {
    const w = await listMessages(ORG, DM, viewer, { mode: 'flat' });
    for (const m of w.messages) {
      expect(m.replies).toEqual([]);
      expect(m.replyCount).toBe(0);
    }
  });
});
