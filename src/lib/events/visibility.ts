// Vuno — who may see one event, as opposed to who may open the conversation.
//
// Conversation membership decides whether you can reach a channel at all. This
// decides what is inside it. The two are different questions and were being
// answered by the same check: `Event.visibility` was written on every row and
// read on none, so an agent that declared a thought private posted it to the
// channel for everyone.
//
// The rule, stated once:
//
//   org, tenant   everyone who can reach the conversation
//   team          members of the team the conversation belongs to
//   private       the member who wrote it, and whoever shares their identity
//                 — an assistant and its owner are one member's reach
//                 (ADR-0009 §2), so a thought private to Bob is visible to Kai
//
// Enforced as a `where` fragment rather than a filter over the result, because
// the window asks for `limit + 1` rows to learn whether history precedes it.
// Dropping rows afterwards would shrink the page and lie about what came
// before; SQLite applies LIMIT after the filter, so asking the database keeps
// the window exact.

import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

/** Everyone whose private events one viewer may read. */
export interface Reach {
  /** Member ids: the viewer, their assistants, and their owner's if they are one. */
  memberIds: string[];
  /** Team ids the viewer belongs to. */
  teamIds: string[];
}

/** Reads nothing back — the orchestrator, the seed, and export are not members. */
export const SYSTEM_REACH: Reach | 'system' = 'system';

/**
 * Resolve one viewer's reach.
 *
 * An assistant and its owner see each other's private events, in both
 * directions: Bob acts for Kai, so a thought Bob keeps to himself is Kai's to
 * read, and Kai's is Bob's. That is the delegation, not a leak — it is why the
 * owner can audit what their assistant concluded before it spoke.
 */
export async function reachOf(viewer: { id: string; ownerMemberId?: string | null }): Promise<Reach> {
  // The identity this viewer shares: their owner if they are an assistant,
  // otherwise themselves.
  const root = viewer.ownerMemberId ?? viewer.id;

  const [assistants, teams] = await Promise.all([
    db.agentProfile.findMany({ where: { ownerMemberId: root }, select: { memberId: true } }),
    db.membership.findMany({ where: { memberId: viewer.id }, select: { teamId: true } }),
  ]);

  const memberIds = new Set<string>([viewer.id, root, ...assistants.map((a) => a.memberId)]);
  return { memberIds: [...memberIds], teamIds: teams.map((t) => t.teamId) };
}

/**
 * The `where` fragment that hides what this viewer may not see.
 *
 * @param teamScopeIds the scopes on which this viewer counts as in-team —
 *   the conversations belonging to a team they are a member of. Passed as a
 *   list rather than one team id because the conversation list asks about
 *   every channel at once, and asking per channel would be a query each.
 */
export function visibleTo(
  reach: Reach | 'system',
  teamScopeIds: readonly string[] = [],
): Prisma.EventWhereInput {
  if (reach === 'system') return {};

  return {
    OR: [
      // The default, written on every event nothing has narrowed.
      { visibility: { in: ['org', 'tenant'] } },
      // Yours, whatever you narrowed it to.
      { visibility: { in: ['team', 'private'] }, actorMemberId: { in: reach.memberIds } },
      // Somebody else's, in a team room you are in.
      ...(teamScopeIds.length > 0
        ? [{ visibility: 'team', scopeId: { in: [...teamScopeIds] } } as Prisma.EventWhereInput]
        : []),
    ],
  };
}

/** The conversations, of those given, whose team this viewer belongs to. */
export function teamScopesFor(
  reach: Reach | 'system',
  conversations: readonly { id: string; teamId: string | null }[],
): string[] {
  if (reach === 'system') return [];
  const teams = new Set(reach.teamIds);
  return conversations.filter((c) => c.teamId && teams.has(c.teamId)).map((c) => c.id);
}

/** True when this event is narrower than the conversation it sits in. */
export function isRestricted(visibility: string): boolean {
  return visibility === 'private' || visibility === 'team';
}
