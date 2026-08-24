// Chats: your assistant pinned at the top, then DMs and group chats you are in.
// No channels, ever — that was the bug where the panel listed `# Aris`.

import { db } from '@/lib/db';
import { listConversations } from '@/lib/conversations';
import { getAssistantFor } from '@/lib/members';
import { currentViewer } from '@/lib/auth';
import { ChatsPane } from '@/components/vuno/chats-pane';

export const dynamic = 'force-dynamic';

export default async function ChatsLayout({ children }: { children: React.ReactNode }) {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) return <>{children}</>;

  const owner = await currentViewer();
  const [conversations, assistant] = await Promise.all([
    listConversations(org.id, owner?.id),
    owner ? getAssistantFor(owner.id) : null,
  ]);

  return (
    <>
      <ChatsPane
        conversations={conversations.filter(
          (c) => c.kind === 'dm' || c.kind === 'group' || c.kind === 'team_room',
        )}
        assistantId={assistant?.id ?? null}
      />
      {children}
    </>
  );
}
