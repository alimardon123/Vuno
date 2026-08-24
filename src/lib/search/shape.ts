// The half of search that has no database in it.
//
// `search()` imports Prisma, and a client component that imports anything from
// that module drags the whole query engine into the browser bundle — which is
// exactly what happened when the call surface imported one constant from
// `@/lib/calls`. So the shapes and the two pure functions live here, and the
// results view imports this file.
//
// Type-only imports below on purpose: `Conversation` and `MemberSummary` come
// from modules that do touch the database, and `import type` is erased.

import type { Conversation, ConversationKind } from '@/lib/conversations';
import type { MemberSummary } from '@/lib/members';

/**
 * The characters `snippet()` wraps a match in.
 *
 * Control characters rather than `<mark>`: the result is rendered as text, and
 * a message body containing the literal string "&lt;mark&gt;" must not be able
 * to decide how it is drawn. `splitSnippet` turns them back into structure.
 */
export const OPEN = '';
export const CLOSE = '';

export interface MessageHit {
  id: string;
  seq: number;
  /** The matched line, elided, with the matched words marked. */
  snippet: string;
  at: string;
  author: MemberSummary | null;
  conversation: { id: string; kind: ConversationKind; name: string };
  /** Set when the message is narrower than the room it was said in. */
  restrictedTo: 'private' | 'team' | null;
}

export interface SearchResults {
  query: string;
  messages: MessageHit[];
  /** Conversations whose name matches — you were looking for the room. */
  conversations: Conversation[];
  /** People and agents whose name or handle matches. */
  members: MemberSummary[];
  /** True when the message list was cut short by `LIMIT`. */
  more: boolean;
}

/**
 * Turn what somebody typed into something FTS5 will accept.
 *
 * FTS5's MATCH takes an expression language — `AND`, `OR`, `NOT`, `NEAR`, `^`,
 * `*`, quoted phrases — and it raises on anything malformed. A search box is
 * not a query language: typing `c++` or an unclosed quote has to find messages
 * about C++, not return a 500.
 *
 * So the input is reduced to its words, each quoted (which makes every operator
 * inert), joined with an implicit AND. The last word gets a `*` because that is
 * what makes a search box feel like it is keeping up: "deplo" finds
 * "deployment" while you are still typing.
 */
export function ftsQuery(raw: string): string | null {
  const words = raw.match(/[\p{L}\p{N}_]+/gu);
  if (!words || words.length === 0) return null;

  // Ten words is already a sentence, and each one costs a merge across the
  // index. Past that a user is pasting, not searching.
  const terms = words.slice(0, 10).map((w) => `"${w.replace(/"/g, '""')}"`);
  return [...terms.slice(0, -1), `${terms[terms.length - 1]}*`].join(' ');
}

/** Split a marked snippet into plain and matched runs, for rendering. */
export function splitSnippet(snippet: string): Array<{ text: string; match: boolean }> {
  return snippet.split(OPEN).flatMap((part, i) => {
    if (i === 0) return part ? [{ text: part, match: false }] : [];
    const [hit, ...rest] = part.split(CLOSE);
    const tail = rest.join(CLOSE);
    return [
      ...(hit ? [{ text: hit, match: true }] : []),
      ...(tail ? [{ text: tail, match: false }] : []),
    ];
  });
}
