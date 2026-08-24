// Vuno — what you can do to a message that is already said.
//
// React, reply, edit, delete, pin. Every one of them is an event appended to
// the spine, never an update to the message — the spine is append-only and has
// exactly one writer (ADR-0004, ADR-0008), and that rule is what makes the
// history of a conversation something you can actually rely on.
//
// Which means "edited" and "deleted" here mean something slightly different
// from what they mean in a database, and better:
//
//   **Edited** — the original stays exactly as it was posted, and a later event
//   supersedes it. The reader sees the new text and an "edited" mark, and the
//   org can still answer "what did it say when I agreed to it".
//
//   **Deleted** — the event stays, the body stops being served. The sequence
//   stays gapless, a reply still has something to point at, and a message
//   somebody quoted does not leave a hole in the record.
//
// Who may do what:
//
//   react     anyone who can read the conversation
//   reply     anyone who can read the conversation
//   edit      the author, and nobody else — not even the org owner, because an
//             edit renders under the author's name
//   delete    the author. (An owner needs to remove something they did not
//             write; that is moderation, it needs its own event so the record
//             says who did it, and it is not built.)
//   pin       anyone who can read the conversation. Pinning is a shared
//             bookmark, and a room where only one person may pin is a room
//             where nothing gets pinned.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { MemberSummary } from '@/lib/members';
import type { NewEventInput } from '@/lib/events/types';

export class MessageActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'MessageActionError';
  }
}

/** One emoji, not an essay. The picker sends one; this stops anything else. */
const EMOJI = /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;

export interface ActionContext {
  tenantId: string;
  orgId: string;
  /** The conversation this is happening in. Access is checked by the caller. */
  channelId: string;
  actor: MemberSummary;
}

/** The message being acted on, once it is known to be real and in this room. */
async function target(ctx: ActionContext, targetEventId: string) {
  const event = await db.event.findFirst({
    where: { id: targetEventId, orgId: ctx.orgId, scopeType: 'channel', scopeId: ctx.channelId },
    select: { id: true, type: true, actorMemberId: true },
  });
  if (!event) {
    // The same answer for "no such message" and "not in this conversation":
    // telling them apart is what a probe is for.
    throw new MessageActionError('That message is not in this conversation.', 404);
  }
  return event;
}

function append(ctx: ActionContext, input: Omit<NewEventInput, 'scopeType' | 'scopeId' | 'actorType'>) {
  const spine = new EventSpine(ctx.tenantId, ctx.orgId);
  return spine.append([
    {
      ...input,
      actorType: 'member',
      actorMemberId: ctx.actor.id,
      scopeType: 'channel',
      scopeId: ctx.channelId,
    } as NewEventInput,
  ]);
}

export async function react(ctx: ActionContext, targetEventId: string, emoji: string, on: boolean): Promise<void> {
  if (!EMOJI.test(emoji)) {
    throw new MessageActionError('A reaction is one emoji.');
  }
  await target(ctx, targetEventId);

  // Idempotent in both directions: clicking an existing reaction twice, or a
  // double-submit, must not leave two of the same thing on a message.
  const already = await hasReaction(ctx.orgId, targetEventId, ctx.actor.id, emoji);
  if (already === on) return;

  await append(ctx, { type: on ? 'ReactionAdded' : 'ReactionRemoved', payload: { emoji, targetEventId } });
}

/** Whether this member's reaction stands right now, from the events themselves. */
async function hasReaction(orgId: string, targetEventId: string, memberId: string, emoji: string): Promise<boolean> {
  const rows = await db.event.findMany({
    where: {
      orgId,
      targetEventId,
      actorMemberId: memberId,
      type: { in: ['ReactionAdded', 'ReactionRemoved'] },
    },
    orderBy: { seq: 'desc' },
    select: { type: true, payload: true },
    take: 50,
  });
  for (const r of rows) {
    try {
      if ((JSON.parse(r.payload as string) as { emoji?: string }).emoji !== emoji) continue;
    } catch {
      continue;
    }
    return r.type === 'ReactionAdded';
  }
  return false;
}

export async function editMessage(ctx: ActionContext, targetEventId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new MessageActionError('An edit that empties a message is a deletion — delete it instead.');
  if (trimmed.length > 4_000) throw new MessageActionError('That is longer than a message can be.');

  const event = await target(ctx, targetEventId);
  if (event.actorMemberId !== ctx.actor.id) {
    throw new MessageActionError('Only the person who wrote a message can edit it.', 403);
  }
  if (event.type !== 'MessagePosted' && event.type !== 'ThreadReplyPosted') {
    throw new MessageActionError('That is a record of something that happened, not a message. It does not get edited.');
  }

  await append(ctx, { type: 'MessageEdited', payload: { targetEventId, body: trimmed } });
}

export async function redactMessage(ctx: ActionContext, targetEventId: string): Promise<void> {
  const event = await target(ctx, targetEventId);
  if (event.actorMemberId !== ctx.actor.id) {
    throw new MessageActionError('Only the person who wrote a message can delete it.', 403);
  }
  await append(ctx, { type: 'MessageRedacted', payload: { targetEventId } });
}

export async function pinMessage(ctx: ActionContext, targetEventId: string, on: boolean): Promise<void> {
  await target(ctx, targetEventId);
  await append(ctx, { type: on ? 'MessagePinned' : 'MessageUnpinned', payload: { targetEventId } });
}

// ─── Reading them back ───────────────────────────────────────────────────────

export interface Reaction {
  emoji: string;
  /** Everyone who has this on right now. */
  by: Array<{ id: string; displayName: string }>;
  /** Whether the viewer is one of them, so the chip can render as pressed. */
  mine: boolean;
}

export interface MessageOverlay {
  reactions: Reaction[];
  /** The current text, when it has been edited. */
  editedBody: string | null;
  editedAt: string | null;
  redacted: boolean;
  pinned: boolean;
}

/** The types that act on another message rather than being one. */
export const ACTION_TYPES = [
  'ReactionAdded',
  'ReactionRemoved',
  'MessageEdited',
  'MessageRedacted',
  'MessagePinned',
  'MessageUnpinned',
] as const;

/**
 * Fold every action taken on a window of messages.
 *
 * One query for the window, not one per message. Ordered by `seq` ascending so
 * the last word wins — a reaction added, removed and added again is on; an
 * edit followed by another edit shows the second.
 *
 * `targetEventId` is a column rather than a field inside the payload for
 * exactly this: SQLite cannot index into a JSON string, and "what happened to
 * these forty messages" is a question this has to answer on every render.
 */
export async function overlayFor(
  orgId: string,
  eventIds: string[],
  viewerId: string,
): Promise<Map<string, MessageOverlay>> {
  const out = new Map<string, MessageOverlay>();
  if (eventIds.length === 0) return out;

  const rows = await db.event.findMany({
    where: { orgId, targetEventId: { in: eventIds }, type: { in: [...ACTION_TYPES] } },
    orderBy: { seq: 'asc' },
    select: { type: true, payload: true, targetEventId: true, actorMemberId: true, createdAt: true },
  });
  if (rows.length === 0) return out;

  const actors = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.actorMemberId).filter((v): v is string => Boolean(v)))];
  if (ids.length > 0) {
    for (const m of await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })) {
      actors.set(m.id, m.displayName);
    }
  }

  /** emoji → member ids, per target, while folding. */
  const reacting = new Map<string, Map<string, Set<string>>>();

  const blank = (): MessageOverlay => ({
    reactions: [],
    editedBody: null,
    editedAt: null,
    redacted: false,
    pinned: false,
  });

  for (const r of rows) {
    const targetId = r.targetEventId;
    if (!targetId) continue;
    let payload: { emoji?: string; body?: string };
    try {
      payload = JSON.parse(r.payload as string) as { emoji?: string; body?: string };
    } catch {
      continue;
    }
    const overlay = out.get(targetId) ?? blank();

    switch (r.type) {
      case 'ReactionAdded':
      case 'ReactionRemoved': {
        if (!payload.emoji || !r.actorMemberId) break;
        const perTarget = reacting.get(targetId) ?? new Map<string, Set<string>>();
        const who = perTarget.get(payload.emoji) ?? new Set<string>();
        if (r.type === 'ReactionAdded') who.add(r.actorMemberId);
        else who.delete(r.actorMemberId);
        perTarget.set(payload.emoji, who);
        reacting.set(targetId, perTarget);
        break;
      }
      case 'MessageEdited':
        if (typeof payload.body === 'string') {
          overlay.editedBody = payload.body;
          overlay.editedAt = String(r.createdAt);
        }
        break;
      case 'MessageRedacted':
        overlay.redacted = true;
        break;
      case 'MessagePinned':
        overlay.pinned = true;
        break;
      case 'MessageUnpinned':
        overlay.pinned = false;
        break;
    }
    out.set(targetId, overlay);
  }

  for (const [targetId, perTarget] of reacting) {
    const overlay = out.get(targetId) ?? blank();
    overlay.reactions = [...perTarget.entries()]
      .filter(([, who]) => who.size > 0)
      .map(([emoji, who]) => ({
        emoji,
        by: [...who].map((id) => ({ id, displayName: actors.get(id) ?? 'Someone' })),
        mine: who.has(viewerId),
      }))
      // Most-reacted first, then stable by emoji so the order does not jitter
      // between renders.
      .sort((a, b) => b.by.length - a.by.length || a.emoji.localeCompare(b.emoji));
    out.set(targetId, overlay);
  }

  return out;
}

/** The pinned messages of a conversation, newest first. */
export async function pinnedIn(orgId: string, channelId: string, limit = 20) {
  const rows = await db.event.findMany({
    where: { orgId, scopeType: 'channel', scopeId: channelId, type: { in: ['MessagePinned', 'MessageUnpinned'] } },
    orderBy: { seq: 'asc' },
    select: { type: true, targetEventId: true },
  });

  const on = new Set<string>();
  for (const r of rows) {
    if (!r.targetEventId) continue;
    if (r.type === 'MessagePinned') on.add(r.targetEventId);
    else on.delete(r.targetEventId);
  }
  if (on.size === 0) return [];

  return db.event.findMany({
    where: { id: { in: [...on] } },
    orderBy: { seq: 'desc' },
    take: limit,
    select: { id: true, seq: true, payload: true, createdAt: true, actorMemberId: true },
  });
}
