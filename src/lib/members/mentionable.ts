// Who `@` can reach in a conversation.
//
// Resolved on the server against the members that exist, which is the same
// rule `extractHandles` uses when the message is posted — a suggestion list
// built from anything else would offer handles that then do nothing.
//
// In a channel that is everyone in the org. In a DM or a group it is the
// participants, plus every agent: summoning an agent into a DM is the whole
// point of the assistant, and it does not turn the DM into a group chat.

import { db } from '@/lib/db';
import { roleLabel } from '@/lib/members';
import type { Conversation } from '@/lib/conversations';

export interface MentionableMember {
  id: string;
  handle: string;
  displayName: string;
  kind: 'human' | 'agent';
  roleLabel: string | null;
}

export async function mentionableIn(orgId: string, conversation: Conversation): Promise<MentionableMember[]> {
  const rows = await db.member.findMany({
    where: { orgId, status: 'active' },
    orderBy: { displayName: 'asc' },
    select: { id: true, handle: true, displayName: true, kind: true, agent: { select: { role: true } } },
  });

  const participants = new Set(conversation.participants.map((m) => m.id));
  const everyone = conversation.kind === 'channel' || conversation.kind === 'team_room';

  return rows
    .filter((m) => everyone || m.kind === 'agent' || participants.has(m.id))
    .map((m) => ({
      id: m.id,
      handle: m.handle,
      displayName: m.displayName,
      kind: m.kind as 'human' | 'agent',
      roleLabel: m.agent?.role ? roleLabel(m.agent.role) : null,
    }));
}
