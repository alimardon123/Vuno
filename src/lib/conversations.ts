// Vuno — conversations, resolved once on the server.
//
// The old code re-derived "is this a channel, a DM or a group chat" from
// `isDm` plus a nullable `teamId` in four different components with four
// different answers, which is why the Channels panel listed `# Aris` and
// `# Bob`. The kind is now stated on the row, and read here — nowhere else.
// (docs/IA-NAVIGATION.md)

import { db } from '@/lib/db';
import { isRestricted, reachOf, teamScopesFor, visibleTo, type Reach } from '@/lib/events/visibility';
import { getMember, memberMap, type MemberSummary } from '@/lib/members';
import { attachmentsForEvents, type StoredAttachment } from '@/lib/attachments';

export type ConversationKind = 'dm' | 'group' | 'team_room' | 'channel';

export interface Conversation {
  id: string;
  kind: ConversationKind;
  name: string;
  slug: string;
  topic: string | null;
  teamId: string | null;
  teamName: string | null;
  /** Everyone in the conversation. A DM names itself from these. */
  participants: MemberSummary[];
  /** The other person in a DM, relative to the viewer. Null for every other kind. */
  counterpart: MemberSummary | null;
  /** Last message, for the list preview — the information the old sidebar lacked. */
  preview: { body: string; at: string; author: string } | null;
  lastActivityAt: string | null;
}

const KINDS = new Set<ConversationKind>(['dm', 'group', 'team_room', 'channel']);

function classify(kind: string): ConversationKind {
  return KINDS.has(kind as ConversationKind) ? (kind as ConversationKind) : 'channel';
}

/**
 * Can this member read this conversation?
 *
 * Until there was authentication there was one viewer, so nothing enforced
 * this and any DM was one URL away from anybody. The rules:
 *
 *   - a channel is the org's, and every member of it can read it;
 *   - a team room is the team's, so its participants can read it;
 *   - a DM or a group chat is its participants', and nobody else's;
 *   - an assistant reads whatever its owner reads (ADR-0009 §2) — that was
 *     asked for explicitly, and it is what makes an assistant useful rather
 *     than a chatbot with amnesia.
 */
export function canRead(
  conversation: Pick<Conversation, 'kind' | 'participants'>,
  viewer: { id: string; ownerMemberId?: string | null } | null,
): boolean {
  if (!viewer) return false;
  if (conversation.kind === 'channel') return true;

  const ids = new Set(conversation.participants.map((m) => m.id));
  if (ids.has(viewer.id)) return true;
  // An assistant sees what its owner sees, including their DMs.
  return Boolean(viewer.ownerMemberId && ids.has(viewer.ownerMemberId));
}

/**
 * One viewer's reach, from the id the caller passed.
 *
 * `'system'` and "nobody" both read unfiltered, matching what the conversation
 * check already does with them: the orchestrator and the seed are not members
 * of anything, and a caller with no viewer has already decided this is not a
 * rendering path.
 */
async function reachFor(viewerId?: string | 'system'): Promise<Reach | 'system'> {
  if (!viewerId || viewerId === 'system') return 'system';
  const viewer = await getMember(viewerId);
  return viewer ? reachOf(viewer) : 'system';
}

/**
 * @param viewerId the member reading the list. A DM's name depends on it — the
 *   same row is "Bob" to Kai and "Kai Alvarez" to Bob — and so does whether it
 *   appears at all.
 */
export async function listConversations(
  orgId: string,
  /**
   * Pass `'system'` deliberately to read unfiltered — the orchestrator and the
   * seed are not members of anything. Anything rendering for a person passes
   * their id, and forgetting to is the one way this check gets skipped, so the
   * bypass is a word you have to type rather than an argument you can omit.
   */
  viewerId?: string | 'system',
): Promise<Conversation[]> {
  const [rows, teams, links] = await Promise.all([
    db.channel.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    db.team.findMany({ where: { orgId }, select: { id: true, name: true } }),
    db.channelMember.findMany({ where: { orgId }, select: { channelId: true, memberId: true } }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // A preview is a quotation of somebody's message in a list, so it answers to
  // the same rule the conversation does: a restricted event must not leak into
  // the sidebar of someone who could not open it.
  const reach = await reachFor(viewerId);

  // One query for the previews rather than one per conversation.
  const latest = await db.event.findMany({
    where: {
      orgId,
      scopeType: 'channel',
      scopeId: { in: rows.map((r) => r.id) },
      type: { in: ['MessagePosted', 'ThreadReplyPosted'] },
      ...visibleTo(reach, teamScopesFor(reach, rows)),
    },
    orderBy: { seq: 'desc' },
    select: { scopeId: true, payload: true, createdAt: true, actorMemberId: true },
    take: 400,
  });

  const members = await memberMap([
    ...latest.map((e) => e.actorMemberId ?? '').filter(Boolean),
    ...links.map((l) => l.memberId),
  ]);

  const roster = new Map<string, MemberSummary[]>();
  for (const l of links) {
    const m = members.get(l.memberId);
    if (!m) continue;
    const list = roster.get(l.channelId);
    if (list) list.push(m);
    else roster.set(l.channelId, [m]);
  }

  const previews = new Map<string, Conversation['preview']>();
  for (const e of latest) {
    if (previews.has(e.scopeId)) continue;
    let body = '';
    try {
      body = (JSON.parse(e.payload as string) as { body?: string }).body ?? '';
    } catch {
      body = '';
    }
    previews.set(e.scopeId, {
      body,
      at: String(e.createdAt),
      author: e.actorMemberId ? (members.get(e.actorMemberId)?.displayName ?? 'Someone') : 'System',
    });
  }

  const resolved = rows.map((r) => {
    const preview = previews.get(r.id) ?? null;
    const kind = classify(r.kind);
    const participants = roster.get(r.id) ?? [];
    // In a DM the viewer is not the subject — the other person is. Falling back
    // to the stored name keeps a DM readable when there is no viewer.
    const counterpart =
      kind === 'dm' ? (participants.find((m) => m.id !== viewerId) ?? participants[0] ?? null) : null;
    return {
      id: r.id,
      kind,
      name: counterpart ? counterpart.displayName : r.name,
      slug: r.slug,
      topic: r.topic,
      teamId: r.teamId,
      teamName: r.teamId ? (teamName.get(r.teamId) ?? null) : null,
      participants,
      counterpart,
      preview,
      lastActivityAt: preview?.at ?? null,
    };
  });

  // What this viewer may read. A list that showed a conversation you cannot
  // open would be a directory of other people's DMs.
  const viewer =
    viewerId && viewerId !== 'system' ? (members.get(viewerId) ?? (await getMember(viewerId))) : null;
  const visible = viewerId === 'system' || !viewerId ? resolved : resolved.filter((c) => canRead(c, viewer));

  // Recency first — a chat list that never reorders is a directory, not an
  // inbox. Quiet conversations fall to the bottom, alphabetically among
  // themselves so their order is at least stable.
  return visible.sort((a, b) => {
    if (a.lastActivityAt && b.lastActivityAt) {
      return a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0;
    }
    if (a.lastActivityAt) return -1;
    if (b.lastActivityAt) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getConversation(
  orgId: string,
  id: string,
  viewerId?: string | 'system',
): Promise<Conversation | null> {
  const all = await listConversations(orgId, viewerId);
  return all.find((c) => c.id === id) ?? null;
}

export interface ConversationMessage {
  id: string;
  seq: number;
  type: string;
  body: string;
  payload: Record<string, unknown>;
  at: string;
  author: MemberSummary | null;
  /** Set only when the action carried another member's authority. */
  onBehalfOf: MemberSummary | null;
  isSystem: boolean;
  /**
   * Set when this event is narrower than the conversation it sits in — an
   * agent's private reasoning, or a note to one team. The reader can see it;
   * this is how they know not everyone in the room can.
   */
  restrictedTo: 'private' | 'team' | null;
  /** Files posted with it. Empty for almost every message. */
  attachments: StoredAttachment[];
}

export interface MessageWindow {
  messages: ConversationMessage[];
  /**
   * The seq to ask for next to see what came before this window, or null at the
   * beginning of the conversation.
   */
  earlier: number | null;
  /** True when this window is history rather than the live end of the stream. */
  isHistory: boolean;
}

/**
 * A window over a conversation, newest first.
 *
 * This used to take the *oldest* 200 events — `orderBy: seq asc, take: 200` —
 * so a channel with five thousand messages opened on the two-week-old ones and
 * showed none of today's. It also meant "60 fps at 5,000 messages" was never
 * actually being measured: the page silently rendered two hundred.
 *
 * The window is bounded on purpose. A chat surface holds a page of history in
 * the DOM and reaches further back by asking, rather than mounting the whole
 * log — which is what keeps the frame budget flat as a channel grows.
 */
export async function listMessages(
  orgId: string,
  conversationId: string,
  /**
   * Who is reading. Required, and `'system'` is the word that reads
   * unfiltered — the same bargain `listConversations` makes, for the same
   * reason: the one way this check gets skipped is an argument somebody
   * forgot, so it is not one you can leave out.
   */
  viewer: { id: string; ownerMemberId?: string | null } | 'system',
  opts: { limit?: number; before?: number } = {},
): Promise<MessageWindow> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);

  const reach = viewer === 'system' ? ('system' as const) : await reachOf(viewer);
  const channel =
    reach === 'system'
      ? null
      : await db.channel.findUnique({ where: { id: conversationId }, select: { teamId: true } });

  // One more than asked for, to learn whether anything precedes this window
  // without a second count query. The visibility filter is part of the query
  // rather than a pass over the result, so `limit + 1` still means "one more
  // than this viewer can see" and `earlier` stays true.
  const rows = await db.event.findMany({
    where: {
      orgId,
      scopeType: 'channel',
      scopeId: conversationId,
      ...(opts.before !== undefined ? { seq: { lt: opts.before } } : {}),
      ...visibleTo(reach, teamScopesFor(reach, [{ id: conversationId, teamId: channel?.teamId ?? null }])),
    },
    orderBy: { seq: 'desc' },
    take: limit + 1,
  });

  const hasOlder = rows.length > limit;
  const page = (hasOlder ? rows.slice(0, limit) : rows).reverse();

  const [members, files] = await Promise.all([
    memberMap(page.flatMap((e) => [e.actorMemberId, e.onBehalfOfMemberId].filter((v): v is string => Boolean(v)))),
    // One query for the window rather than one per message: a page of 200
    // messages with a screenshot each is 200 round trips the other way.
    attachmentsForEvents(page.map((e) => e.id)),
  ]);

  const messages = page.map((e) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(e.payload as string) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return {
      id: e.id,
      seq: e.seq,
      type: e.type,
      body: typeof payload.body === 'string' ? payload.body : '',
      payload,
      at: String(e.createdAt),
      author: e.actorMemberId ? (members.get(e.actorMemberId) ?? null) : null,
      onBehalfOf: e.onBehalfOfMemberId ? (members.get(e.onBehalfOfMemberId) ?? null) : null,
      attachments: files.get(e.id) ?? [],
      isSystem: e.actorType === 'system',
      restrictedTo: isRestricted(e.visibility) ? (e.visibility as 'private' | 'team') : null,
    };
  });

  return {
    messages,
    earlier: hasOlder && messages.length > 0 ? messages[0].seq : null,
    isHistory: opts.before !== undefined,
  };
}
