import { Empty } from '@/components/vuno/primitives';

export default function ChatsIndex() {
  return (
    <main className="hidden min-w-0 flex-1 items-center justify-center md:flex">
      <Empty
        title="Pick a conversation"
        hint="Your assistant is pinned at the top. Chats holds direct messages, group chats and team rooms — channels live in their own tab."
      />
    </main>
  );
}
