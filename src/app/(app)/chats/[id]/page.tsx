import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getConversation, listMessages } from '@/lib/conversations';
import { getOrgOwner } from '@/lib/members';
import { ConversationView } from '@/components/vuno/conversation-view';

export const dynamic = 'force-dynamic';

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) notFound();

  const owner = await getOrgOwner(org.id);
  const conversation = await getConversation(org.id, id, owner?.id);
  if (!conversation) notFound();

  const messages = await listMessages(org.id, id);
  return <ConversationView conversation={conversation} messages={messages} />;
}
