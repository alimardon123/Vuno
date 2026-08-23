'use client';

// The centre column. A header you can click for details, the stream, and the
// typed composer — which is the primary composer here, not a mode you switch
// into: an objection and a message are both things you say.

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { MessageList } from '@/components/vuno/message-list';
import { Composer } from '@/components/vuno/composer';
import { Avatar, Empty } from '@/components/vuno/primitives';
import type { Conversation, ConversationMessage } from '@/lib/conversations';

const KIND_LABEL: Record<Conversation['kind'], string> = {
  dm: 'Direct message',
  group: 'Group chat',
  team_room: 'Team room',
  channel: 'Channel',
};

export function ConversationView({
  conversation,
  messages,
}: {
  conversation: Conversation;
  messages: ConversationMessage[];
}) {
  // On a phone the list pane steps aside for the conversation, so this header
  // is the only way back to it.
  const backTo = conversation.kind === 'channel' ? '/channels' : '/chats';
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[var(--bg)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-2">
        <Link
          href={backTo}
          aria-label={`Back to ${backTo === '/chats' ? 'Chats' : 'Channels'}`}
          className="-ml-1.5 grid size-7 shrink-0 place-items-center rounded-md text-[var(--fg-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] md:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        {conversation.kind === 'channel' || conversation.kind === 'team_room' ? (
          <span className="text-[15px] leading-none text-[var(--fg-3)]" aria-hidden>#</span>
        ) : (
          <Avatar name={conversation.name} kind={conversation.kind === 'dm' ? 'human' : 'agent'} size="sm" />
        )}
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-[13.5px] font-semibold tracking-[-0.012em]">{conversation.name}</h1>
          {conversation.topic ? (
            <p className="truncate text-[11px] text-[var(--fg-3)]">{conversation.topic}</p>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-[var(--fg-4)]">
          <span>{KIND_LABEL[conversation.kind]}</span>
          {conversation.teamName ? (
            <span className="rounded-[4px] border border-[var(--line)] bg-[var(--sunken)] px-1.5 py-px text-[10px] text-[var(--fg-3)]">
              {conversation.teamName}
            </span>
          ) : null}
        </div>
      </header>

      <div className="scroll-y min-h-0 flex-1">
        {messages.length === 0 ? (
          <Empty title="No messages yet" hint="Say something, or file a proposal — a proposal becomes a claim on the ledger." />
        ) : (
          <MessageList messages={messages} />
        )}
        <div ref={bottom} />
      </div>

      <Composer conversationId={conversation.id} conversationName={conversation.name} />
    </main>
  );
}
