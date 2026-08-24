import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getConversation, listMessages } from '@/lib/conversations';
import { currentViewer } from '@/lib/auth';
import { ConversationView } from '@/components/vuno/conversation-view';
import { mentionableIn } from '@/lib/members/mentionable';
import { meetingsIn } from '@/lib/meetings';

export const dynamic = 'force-dynamic';

export default async function ChatPage({
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

  // A DM names itself from whoever is reading it, which only became true
  // once there was more than one possible reader.
  const viewer = await currentViewer();
  if (!viewer) notFound();
  const conversation = await getConversation(org.id, id, viewer.id);
  if (!conversation) notFound();

  // `before` walks back through history, so a point in a long conversation is
  // a link someone can send.
  const cursor = Number(before);
  const window = await listMessages(org.id, id, viewer, {
    before: Number.isFinite(cursor) && cursor > 0 ? cursor : undefined,
  });
  return (
    <ConversationView
      conversation={conversation}
      window={window}
      mentionable={await mentionableIn(org.id, conversation)}
      viewerId={viewer.id}
      meetings={await meetingsIn(org.id, id)}
    />
  );
}
