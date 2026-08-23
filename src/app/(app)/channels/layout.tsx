import { db } from '@/lib/db';
import { listConversations } from '@/lib/conversations';
import { ChannelsPane } from '@/components/vuno/channels-pane';

export const dynamic = 'force-dynamic';

export default async function ChannelsLayout({ children }: { children: React.ReactNode }) {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) return <>{children}</>;
  const conversations = await listConversations(org.id);
  return (
    <>
      {/* Team rooms live in Chats with a team badge, not here (docs/IA-NAVIGATION.md). */}
      <ChannelsPane conversations={conversations.filter((c) => c.kind === 'channel')} />
      {children}
    </>
  );
}
