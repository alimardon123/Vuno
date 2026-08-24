'use client';

// The centre column. A header you can click for details, the stream, and the
// typed composer — which is the primary composer here, not a mode you switch
// into: an objection and a message are both things you say.

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useConversationStream } from '@/hooks/use-conversation-stream';
import { MessageList } from '@/components/vuno/message-list';
import { Composer, type Mentionable } from '@/components/vuno/composer';
import { Avatar, Empty } from '@/components/vuno/primitives';
import type { Conversation, MessageWindow } from '@/lib/conversations';

/**
 * `useLayoutEffect`, except on the server, where it does nothing and warns.
 *
 * This component is server-rendered before it hydrates, and the one thing that
 * has to happen before paint — putting a busy conversation at its live end —
 * is exactly what `useLayoutEffect` is for.
 */
const useLayoutEffectOnClient = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const KIND_LABEL: Record<Conversation['kind'], string> = {
  dm: 'Direct message',
  group: 'Group chat',
  team_room: 'Team room',
  channel: 'Channel',
};

export function ConversationView({
  conversation,
  window: view,
  mentionable = [],
}: {
  conversation: Conversation;
  window: MessageWindow;
  /** Everyone `@` can reach here, resolved on the server. */
  mentionable?: Mentionable[];
}) {
  const { messages, earlier, isHistory } = view;

  // An agent answering an @mention runs in the orchestrator and lands seconds
  // later; without this the reply is invisible until you reload. Off while
  // reading history — a window of the past does not change.
  useConversationStream(conversation.id, messages[messages.length - 1]?.seq ?? 0, !isHistory);
  // On a phone the list pane steps aside for the conversation, so this header
  // is the only way back to it.
  const basePath = conversation.kind === 'channel' ? '/channels' : '/chats';
  const backTo = basePath;
  const bottom = useRef<HTMLDivElement>(null);

  const stream = useRef<HTMLDivElement>(null);
  // A stable id so the inline script below can find this element. Derived from
  // the conversation rather than random, so the server and the client agree.
  const streamId = `stream-${conversation.id}`;
  /** Whether the reader is at the live end, rather than scrolled up reading. */
  const atBottom = useRef(true);

  /**
   * How far from the bottom still counts as "at the bottom".
   *
   * Generous, because a reader a line or two up has not left the conversation —
   * and because a browser that is mid-smooth-scroll reports a position that is
   * a few pixels short of where it is going.
   */
  const NEAR = 120;

  const scrollToEnd = useCallback((force = false) => {
    if (isHistory) return;
    if (!force && !atBottom.current) return;
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [isHistory]);

  // Track where the reader is. Without this every new message drags them back
  // down mid-sentence, which is the behaviour that makes a busy channel
  // unreadable — and, on a hard load of a long conversation, the scroll fires
  // under whatever they were about to click.
  useEffect(() => {
    const el = stream.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR;
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Opening a conversation lands at the live end; a new message only follows if
  // that is where the reader already was.
  //
  // The first paint is handled by the inline script below, not here — no effect
  // of any kind runs until React has hydrated, and on a busy channel that is
  // several hundred milliseconds of the oldest messages on screen followed by a
  // ten-thousand-pixel jump. Anything clicked in that window landed somewhere
  // else; "Earlier messages" became an image three screens below it, reliably
  // enough that the browser suite caught it. This handles moving *between*
  // conversations, where hydration has already happened.
  useLayoutEffectOnClient(() => {
    scrollToEnd(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  useEffect(() => {
    scrollToEnd();
  }, [messages.length, scrollToEnd]);

  // An image finishing its download makes the message taller than it was when
  // the scroll above ran, so the bottom of it ends up under the composer.
  // Uploads record their pixel size, which reserves the space — but a browser
  // that has not decoded the file yet still lays it out at zero, and messages
  // from before attachments existed have no size at all.
  useEffect(() => {
    const el = stream.current;
    if (!el) return;
    const onLoad = (e: Event) => {
      if ((e.target as HTMLElement).tagName === 'IMG') scrollToEnd();
    };
    // Capture, because `load` on an image does not bubble.
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, [scrollToEnd]);

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

      <div ref={stream} id={streamId} className="scroll-y min-h-0 flex-1">
        {/* The window is bounded, so history is reached by asking for it — and
            because the cursor is in the URL, a point in a long conversation is
            a link someone can send. */}
        {earlier !== null ? (
          <div className="flex justify-center py-2">
            <Link
              href={`${basePath}/${conversation.id}?before=${earlier}`}
              className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11.5px] text-[var(--fg-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              Earlier messages
            </Link>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <Empty title="No messages yet" hint="Say something, or file a proposal — a proposal becomes a claim on the ledger." />
        ) : (
          <MessageList messages={messages} />
        )}

        {isHistory ? (
          <div className="flex justify-center py-2">
            <Link
              href={`${basePath}/${conversation.id}`}
              className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11.5px] text-[var(--fg-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              Jump to the latest
            </Link>
          </div>
        ) : null}
        <div ref={bottom} />
      </div>
      {/* Runs while the browser is still parsing, so the conversation is drawn
          at its live end rather than scrolled there afterwards. The same
          technique the theme bootstrap uses (src/app/layout.tsx), for the same
          reason: some things have to be right on the first paint, and hydration
          is far too late. */}
      {!isHistory ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var e=document.getElementById(${JSON.stringify(streamId)});if(e)e.scrollTop=e.scrollHeight;})()`,
          }}
        />
      ) : null}

      <Composer
        conversationId={conversation.id}
        conversationName={conversation.name}
        mentionable={mentionable}
      />
    </main>
  );
}
