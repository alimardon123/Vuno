// Vuno — finding one message in fifty thousand.
//
// The index is an FTS5 virtual table whose rowid is `Event.seq`, kept true by
// SQL triggers (prisma/migrations/20260824160000_search). It holds text and
// nothing else, which is the point: a hit is a sequence number, and the row it
// names is where the author, the conversation and the visibility actually live.
//
// So this runs in two phases, and the split is deliberate:
//
//   1. FTS5 ranks. It answers "which messages contain these words, best first"
//      and knows nothing about who is asking.
//   2. Prisma filters, using `visibleTo()` — the same fragment the conversation
//      window and the sidebar preview use.
//
// The alternative is one SQL query with the visibility rule written a second
// time in raw SQL, and a security rule with two implementations has one that is
// out of date. It is the sidebar-preview leak (src/lib/events/visibility.ts)
// waiting to happen on a surface that searches every conversation at once.
//
// The cost of the split is a cap: a query matching more than `CANDIDATES`
// messages ranks within those, and anything the viewer cannot read is spent
// budget. That is a bounded, stated limit rather than a silent one, and it is
// the same bargain every chat search makes.
//
// Measured on the seeded spine — 50,247 indexed messages, p50 of 15 runs:
//
//   "depl"                     0.2 ms   a distinctive word
//   "the rollout"              0.3 ms   two words, one of them in every message
//   "p99 latency read"         1.2 ms   three words
//   whole call, distinctive   10.0 ms   including the conversation list
//   "the"                     53.0 ms   one ultra-common word, alone
//
// The last line is the only slow shape, and it is not worth engineering
// against: FTS5 intersects from the rarest term, so adding any second word
// collapses it to 0.3 ms, and "the" on its own is a query with no useful answer
// to give. The 8 ms floor on every call is `listConversations`, which is needed
// anyway to name the room each hit came from.

import { db } from '@/lib/db';
import { reachOf, visibleTo, isRestricted, type Reach } from '@/lib/events/visibility';
import { memberMap, type MemberSummary } from '@/lib/members';
import { listConversations, type Conversation } from '@/lib/conversations';
import { CLOSE, OPEN, ftsQuery, type MessageHit, type SearchResults } from '@/lib/search/shape';

// The pure half — the shapes, the query builder and the snippet splitter — is
// in `shape.ts` so the results view can import them without importing Prisma.
export * from '@/lib/search/shape';

/** How many ranked matches to consider before the viewer's rules are applied. */
const CANDIDATES = 500;

/** How many survive onto the page. */
export const LIMIT = 40;

const EMPTY = (query: string): SearchResults => ({
  query,
  messages: [],
  conversations: [],
  members: [],
  more: false,
});

interface Candidate {
  seq: bigint | number;
  snippet: string;
}

/**
 * Search everything this member can read.
 *
 * @param viewer the member asking. There is no `'system'` bypass here — the
 *   orchestrator does not search, and a search with no viewer is a query that
 *   returns every DM in the org.
 */
export async function search(
  orgId: string,
  viewer: { id: string; ownerMemberId?: string | null },
  raw: string,
): Promise<SearchResults> {
  const query = raw.trim();
  const match = ftsQuery(query);
  if (!match) return EMPTY(query);

  // Conversations first: the readable set is needed either way — to name the
  // room each hit came from, and because a conversation the viewer cannot open
  // must not surface its contents through a search box.
  const conversations = await listConversations(orgId, viewer.id);
  const byId = new Map(conversations.map((c) => [c.id, c]));

  const [candidates, reach] = await Promise.all([
    // `?` bindings, not interpolation: `ftsQuery` already made the input inert,
    // and this makes it inert twice.
    db.$queryRawUnsafe<Candidate[]>(
      `SELECT rowid AS seq, snippet("EventSearch", 0, ?, ?, '…', 14) AS snippet
         FROM "EventSearch"
        WHERE "EventSearch" MATCH ? AND "orgId" = ?
        ORDER BY rank
        LIMIT ?`,
      OPEN,
      CLOSE,
      match,
      orgId,
      CANDIDATES,
    ),
    reachOf(viewer),
  ]);

  const messages = candidates.length > 0
    ? await resolve(orgId, candidates, reach, byId)
    : [];

  // Names are matched word by word, not as one string: "storage engine" has to
  // find `#storage-engine`, and searching a full name has to find the person.
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const namesMatch = (name: string) => {
    const lower = name.toLowerCase();
    return words.every((w) => lower.includes(w));
  };

  return {
    query,
    messages: messages.slice(0, LIMIT),
    conversations: conversations.filter((c) => namesMatch(c.name)).slice(0, 8),
    members: await matchingMembers(orgId, words),
    more: messages.length > LIMIT,
  };
}

/**
 * Turn ranked sequence numbers into messages the viewer may actually see.
 *
 * The visibility filter is a `where` fragment rather than a pass over the
 * result for the usual reason — but here there is a second one. `seq` is the
 * primary key, so this is an index lookup of a few hundred keys, and asking the
 * database to drop the ones this member cannot read costs nothing over asking
 * for all of them.
 */
async function resolve(
  orgId: string,
  candidates: Candidate[],
  reach: Reach,
  conversations: Map<string, Conversation>,
): Promise<MessageHit[]> {
  const seqs = candidates.map((c) => Number(c.seq));
  const snippets = new Map(candidates.map((c) => [Number(c.seq), c.snippet]));

  const rows = await db.event.findMany({
    where: {
      orgId,
      seq: { in: seqs },
      scopeType: 'channel',
      // The rooms this member can open. A hit in a DM they are not in is not a
      // result, however well it ranks.
      scopeId: { in: [...conversations.keys()] },
      ...visibleTo(
        reach,
        // A team room the viewer belongs to lets them read other people's
        // team-scoped events in it — same rule as the window, same source.
        [...conversations.values()].filter((c) => c.teamId && reach.teamIds.includes(c.teamId)).map((c) => c.id),
      ),
    },
    select: { id: true, seq: true, scopeId: true, actorMemberId: true, visibility: true, createdAt: true },
  });

  const members = await memberMap(rows.map((r) => r.actorMemberId ?? '').filter(Boolean));

  // Back into rank order. The database returned them by primary key, and the
  // whole value of a search is that the best one is first.
  const rank = new Map(seqs.map((s, i) => [s, i]));

  return rows
    .sort((a, b) => (rank.get(a.seq) ?? 0) - (rank.get(b.seq) ?? 0))
    .map((r) => {
      const conversation = conversations.get(r.scopeId);
      return {
        id: r.id,
        seq: r.seq,
        snippet: snippets.get(r.seq) ?? '',
        at: String(r.createdAt),
        author: r.actorMemberId ? (members.get(r.actorMemberId) ?? null) : null,
        conversation: {
          id: r.scopeId,
          kind: conversation?.kind ?? 'channel',
          name: conversation?.name ?? 'a conversation',
        },
        restrictedTo: isRestricted(r.visibility) ? (r.visibility as 'private' | 'team') : null,
      };
    });
}

/**
 * People and agents whose name or handle contains the term.
 *
 * Not in the full-text index: a roster is hundreds of rows, not fifty thousand,
 * and a substring match is what you want on a name — searching "ari" should
 * find Aris, which a word-boundary tokeniser would not do.
 */
async function matchingMembers(orgId: string, words: string[]): Promise<MemberSummary[]> {
  if (words.length === 0) return [];

  const rows = await db.member.findMany({
    where: {
      orgId,
      status: { not: 'retired' },
      // Every word, so "kai alvarez" finds Kai Alvarez rather than everyone
      // called Kai. SQLite's LIKE is case-insensitive over ASCII, which is what
      // `contains` compiles to.
      AND: words.map((w) => ({
        OR: [{ displayName: { contains: w } }, { handle: { contains: w } }],
      })),
    },
    select: { id: true },
    take: 8,
  });
  if (rows.length === 0) return [];
  const map = await memberMap(rows.map((r) => r.id));
  return rows.map((r) => map.get(r.id)).filter((m): m is MemberSummary => Boolean(m));
}
