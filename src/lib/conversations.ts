// Vuno — conversations, resolved once on the server.
//
// The old code re-derived "is this a channel, a DM or a group chat" from
// `isDm` plus a nullable `teamId` in four different components with four
// different answers, which is why the Channels panel listed `# Aris` and
// `# Bob`. The kind is now stated on the row, and read here — nowhere else.
// (docs/IA-NAVIGATION.md)

import { db } from '@/lib/db';
import { memberMap, type MemberSummary } from '@/lib/members';

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
 * @param viewerId the member reading the list. A DM's name depends on it: the
 *   same row is "Bob" to Kai and "Kai Alvarez" to Bob.
 */
export async function listConversations(orgId: string, viewerId?: string): Promise<Conversation[]> {
  const [rows, teams, links] = await Promise.all([
    db.channel.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    db.team.findMany({ where: { orgId }, select: { id: true, name: true } }),
    db.channelMember.findMany({ where: { orgId }, select: { channelId: true, memberId: true } }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // One query for the previews rather than one per conversation.
  const latest = await db.event.findMany({
    where: {
      orgId,
      scopeType: 'channel',
      scopeId: { in: rows.map((r) => r.id) },
      type: { in: ['MessagePosted', 'ThreadReplyPosted'] },
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

  // Recency first — a chat list that never reorders is a directory, not an
  // inbox. Quiet conversations fall to the bottom, alphabetically among
  // themselves so their order is at least stable.
  return resolved.sort((a, b) => {
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
  viewerId?: string,
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
}

export async function listMessages(orgId: string, conversationId: string, limit = 200): Promise<ConversationMessage[]> {
  const events = await db.event.findMany({
    where: { orgId, scopeType: 'channel', scopeId: conversationId },
    orderBy: { seq: 'asc' },
    take: limit,
  });

  const members = await memberMap(
    events.flatMap((e) => [e.actorMemberId, e.onBehalfOfMemberId].filter((v): v is string => Boolean(v))),
  );

  return events.map((e) => {
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
      isSystem: e.actorType === 'system',
    };
  });
}
