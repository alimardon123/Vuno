import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getConversation, listMessages } from '@/lib/conversations';
import { ConversationView } from '@/components/vuno/conversation-view';

export const dynamic = 'force-dynamic';

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { id } = await params;
  const { before } = await searchParams;
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) notFound();
  const conversation = await getConversation(org.id, id);
  if (!conversation) notFound();
  // `before` walks back through history, so a point in a long conversation is
  // a link someone can send.
  const cursor = Number(before);
  const window = await listMessages(org.id, id, {
    before: Number.isFinite(cursor) && cursor > 0 ? cursor : undefined,
  });
  return <ConversationView conversation={conversation} window={window} />;
}
