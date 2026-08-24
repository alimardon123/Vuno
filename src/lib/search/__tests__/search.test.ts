// Search is the surface where a visibility bug is worst.
//
// Everywhere else you have to already be in the room to see something you
// should not. A search box takes a word and looks in every conversation in the
// org at once, so the failure mode is not "Kai sees one message he shouldn't" —
// it is a probe: type a word, learn what is in other people's DMs.
//
// Which is why most of this file is about what does *not* come back.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { redactMessage, editMessage } from '@/lib/messages/actions';
import { ftsQuery, splitSnippet, search } from '@/lib/search';
import type { MemberSummary } from '@/lib/members';

const TENANT = 'tnt-search';
const ORG = 'org-search';
const CHANNEL = 'ch-search-open';
const TEAM_ROOM = 'ch-search-team';
const THEIR_DM = 'ch-search-their-dm';
const TEAM = 'tm-search';
const DEPT = 'dep-search';

const KAI = 'mbr-search-kai';
const MIRA = 'mbr-search-mira';
const NOA = 'mbr-search-noa';

/** Kai: in the channel and the team. Not in Mira and Noa's DM. */
const kai = { id: KAI, ownerMemberId: null };
const mira = { id: MIRA, ownerMemberId: null };

const spine = () => new EventSpine(TENANT, ORG);

async function post(
  scopeId: string,
  body: string,
  by = KAI,
  visibility: 'org' | 'team' | 'private' = 'org',
): Promise<string> {
  const [e] = await spine().append([
    {
      type: 'MessagePosted',
      actorType: 'member',
      actorMemberId: by,
      scopeType: 'channel',
      scopeId,
      visibility,
      payload: { body },
    },
  ]);
  return e.id;
}

const bodies = (r: { messages: Array<{ snippet: string }> }) =>
  r.messages.map((m) => m.snippet.replace(/[]/g, ''));

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'search-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'search-o' } });
  await db.department.create({ data: { id: DEPT, tenantId: TENANT, orgId: ORG, name: 'D', slug: 'search-d' } });
  await db.team.create({
    data: { id: TEAM, tenantId: TENANT, orgId: ORG, departmentId: DEPT, name: 'Search Team', slug: 'search-team' },
  });
  for (const [id, name, handle] of [
    [KAI, 'Kai Alvarez', 'search-kai'],
    [MIRA, 'Mira', 'search-mira'],
    [NOA, 'Noa', 'search-noa'],
  ]) {
    await db.member.create({
      data: { id, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: name, handle },
    });
  }
  // Kai is in the team; Noa is not.
  for (const memberId of [KAI, MIRA]) {
    await db.membership.create({ data: { tenantId: TENANT, orgId: ORG, teamId: TEAM, memberId, role: 'member' } });
  }

  await db.channel.create({
    data: { id: CHANNEL, tenantId: TENANT, orgId: ORG, kind: 'channel', name: 'quasar-lab', slug: 'quasar-lab' },
  });
  await db.channel.create({
    data: {
      id: TEAM_ROOM, tenantId: TENANT, orgId: ORG, kind: 'team_room',
      name: 'search-team-room', slug: 'search-team-room', teamId: TEAM,
    },
  });
  await db.channel.create({
    data: { id: THEIR_DM, tenantId: TENANT, orgId: ORG, kind: 'dm', name: 'search-their-dm', slug: 'search-their-dm' },
  });
  for (const memberId of [KAI, MIRA]) {
    await db.channelMember.create({ data: { tenantId: TENANT, orgId: ORG, channelId: TEAM_ROOM, memberId } });
  }
  // Mira and Noa's DM. Kai is not in it.
  for (const memberId of [MIRA, NOA]) {
    await db.channelMember.create({ data: { tenantId: TENANT, orgId: ORG, channelId: THEIR_DM, memberId } });
  }
});

afterAll(async () => {
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.channelMember.deleteMany({ where: { orgId: ORG } });
  await db.channel.deleteMany({ where: { orgId: ORG } });
  await db.membership.deleteMany({ where: { orgId: ORG } });
  await db.team.deleteMany({ where: { orgId: ORG } });
  await db.department.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('turning typing into a query', () => {
  test('the last word is a prefix, so it keeps up with typing', () => {
    expect(ftsQuery('deplo')).toBe('"deplo"*');
    expect(ftsQuery('cold start')).toBe('"cold" "start"*');
  });

  test('operators and punctuation are inert, not errors', () => {
    // Every one of these is valid FTS5 syntax that means something other than
    // what the person typing it meant, or is malformed and raises.
    expect(ftsQuery('c++')).toBe('"c"*');
    expect(ftsQuery('NEAR OR AND')).toBe('"NEAR" "OR" "AND"*');
    expect(ftsQuery('"unclosed')).toBe('"unclosed"*');
    expect(ftsQuery('a" OR b')).toBe('"a" "OR" "b"*');
  });

  test('nothing to search for is null, not an empty match-everything', () => {
    expect(ftsQuery('')).toBeNull();
    expect(ftsQuery('   ')).toBeNull();
    expect(ftsQuery('!!! ...')).toBeNull();
  });

  test('a pasted paragraph is cut to ten words', () => {
    const q = ftsQuery('one two three four five six seven eight nine ten eleven twelve');
    expect(q?.split(' ')).toHaveLength(10);
    expect(q).toContain('"ten"*');
    expect(q).not.toContain('eleven');
  });
});

describe('marking the match', () => {
  test('splits into plain and matched runs', () => {
    expect(splitSnippet('the cold start')).toEqual([
      { text: 'the ', match: false },
      { text: 'cold', match: true },
      { text: ' start', match: false },
    ]);
  });

  test('handles a match at each end', () => {
    expect(splitSnippet('cold')).toEqual([{ text: 'cold', match: true }]);
    expect(splitSnippet('plain')).toEqual([{ text: 'plain', match: false }]);
  });
});

describe('what a search finds', () => {
  test('a word said in a channel, marked', async () => {
    await post(CHANNEL, 'The quasar telemetry pipeline is dropping frames');

    const found = await search(ORG, kai, 'telemetry');
    expect(found.messages).toHaveLength(1);
    expect(found.messages[0].conversation.name).toBe('quasar-lab');
    expect(found.messages[0].author?.displayName).toBe('Kai Alvarez');
    // The marked run is the word that matched, not the whole line.
    expect(splitSnippet(found.messages[0].snippet).filter((p) => p.match).map((p) => p.text))
      .toEqual(['telemetry']);
  });

  test('both words, or neither — terms are ANDed', async () => {
    await post(CHANNEL, 'zephyr alone');
    await post(CHANNEL, 'zephyr with borealis');

    expect(bodies(await search(ORG, kai, 'zephyr borealis'))).toEqual(['zephyr with borealis']);
  });

  test('a prefix, so it answers while you are still typing', async () => {
    await post(CHANNEL, 'the reconciliation loop stalled');
    expect(bodies(await search(ORG, kai, 'reconcil'))).toContain('the reconciliation loop stalled');
  });

  test('the conversation you meant, and the person', async () => {
    const found = await search(ORG, kai, 'quasar');
    expect(found.conversations.map((c) => c.name)).toContain('quasar-lab');

    const people = await search(ORG, kai, 'alvarez');
    expect(people.members.map((m) => m.displayName)).toContain('Kai Alvarez');
  });

  test('names match word by word, not as one string', async () => {
    // "quasar lab" has to find `quasar-lab`. Matching the whole typed string
    // against the name fails on the hyphen, which is every channel name here.
    expect((await search(ORG, kai, 'quasar lab')).conversations.map((c) => c.name))
      .toContain('quasar-lab');
    // And a full name finds the person rather than everyone sharing a first name.
    expect((await search(ORG, kai, 'kai alvarez')).members.map((m) => m.displayName))
      .toEqual(['Kai Alvarez']);
    // Both words, or neither. "kai" alone matches; "kai borealis" must not.
    expect((await search(ORG, kai, 'kai borealis')).members).toEqual([]);
  });

  test('nothing typed is nothing found, not everything', async () => {
    const found = await search(ORG, kai, '   ');
    expect(found).toEqual({ query: '', messages: [], conversations: [], members: [], more: false });
  });
});

describe('what a search must never find', () => {
  test('a message in a DM the searcher is not in', async () => {
    await post(THEIR_DM, 'the acquisition closes on Tuesday', MIRA);

    expect(bodies(await search(ORG, kai, 'acquisition'))).toEqual([]);
    // And it is genuinely findable by somebody who is in it — otherwise this
    // test would pass on a search that is simply broken.
    expect(bodies(await search(ORG, mira, 'acquisition'))).toEqual(['the acquisition closes on Tuesday']);
  });

  test("somebody else's private thought in a room the searcher is in", async () => {
    await post(CHANNEL, 'privately unconvinced by the benchmark', MIRA, 'private');

    expect(bodies(await search(ORG, kai, 'unconvinced'))).toEqual([]);
    expect(bodies(await search(ORG, mira, 'unconvinced'))).toEqual(['privately unconvinced by the benchmark']);
  });

  test('a team-scoped message, unless the searcher is in that team', async () => {
    await post(TEAM_ROOM, 'the shibboleth rotation is Thursday', MIRA, 'team');

    // Kai is in the team, so the team room is his to read.
    expect(bodies(await search(ORG, kai, 'shibboleth'))).toEqual(['the shibboleth rotation is Thursday']);
    // Noa is in neither the team nor the room.
    expect(bodies(await search(ORG, { id: NOA, ownerMemberId: null }, 'shibboleth'))).toEqual([]);
  });

  test('a message that was deleted', async () => {
    const id = await post(CHANNEL, 'the embargoed figure is 4.2 million');
    expect(bodies(await search(ORG, kai, 'embargoed'))).toHaveLength(1);

    await redactMessage(
      { tenantId: TENANT, orgId: ORG, channelId: CHANNEL, actor: { id: KAI } as MemberSummary },
      id,
    );

    // Not "returned without a body" — gone. A search result *is* the body, so
    // serving a snippet of a deleted message is the deletion not happening.
    expect(bodies(await search(ORG, kai, 'embargoed'))).toEqual([]);
  });

  test('what a message used to say, once it is edited', async () => {
    const id = await post(CHANNEL, 'the rollout is on Wednesday');

    await editMessage(
      { tenantId: TENANT, orgId: ORG, channelId: CHANNEL, actor: { id: KAI } as MemberSummary },
      id,
      'the rollout is on Friday',
    );

    expect(bodies(await search(ORG, kai, 'rollout Wednesday'))).toEqual([]);
    expect(bodies(await search(ORG, kai, 'rollout Friday'))).toEqual(['the rollout is on Friday']);
  });
});

describe('the index against the spine', () => {
  test('an event deleted out from under it leaves nothing behind', async () => {
    const id = await post(CHANNEL, 'orphanhunt');
    expect(bodies(await search(ORG, kai, 'orphanhunt'))).toHaveLength(1);

    // Nothing in the app deletes an event — the spine is append-only. An org
    // being removed does, and so does every test in this repo tearing down, and
    // an index still holding that seq would serve a result that resolves to
    // nothing.
    await db.event.deleteMany({ where: { id } });
    expect(bodies(await search(ORG, kai, 'orphanhunt'))).toEqual([]);
  });
});
