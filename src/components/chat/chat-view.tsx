// Vuno — Chat view
// Fetches /api/events?scopeType=channel&scopeId=<id>&project=true and renders
// the projected chat messages. Includes a typed composer.

'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { MessageBubble } from '@/components/chat/message-bubble';
import { TypedComposer } from '@/components/chat/typed-composer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect, useRef } from 'react';
import { Hash, Users, Pin } from 'lucide-react';
import type { ChatMessageProjection } from '@/lib/events/project';

interface EventsResponse {
  events: unknown[];
  chatMessages: ChatMessageProjection[];
}

interface ChannelsResponse {
  channels: { id: string; name: string; topic: string | null; teamId: string | null }[];
  teams: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

export function ChatView() {
  const { activeChannelId, activeDecisionId, setActiveDecision, chatNonce } =
    useAppStore();

  // Channels list (so we can show the channel header even if we don't have the channel preloaded)
  const channelsRes = useFetch<ChannelsResponse>('/api/channels');
  const channels = channelsRes.data?.channels ?? [];
  const channel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const eventsUrl = activeChannelId
    ? `/api/events?scopeType=channel&scopeId=${activeChannelId}&project=true`
    : null;
  const eventsRes = useFetch<EventsResponse>(eventsUrl, {
    intervalMs: 5000,
  });

  // refetch when the chat nonce bumps (e.g. after posting a message)
  useEffect(() => {
    if (chatNonce > 0) {
      eventsRes.refetch();
    }
    // eventsRes.refetch is stable; we intentionally only depend on chatNonce
  }, [chatNonce, eventsRes]);

  const messages = eventsRes.data?.chatMessages ?? [];

  // autoscroll to bottom
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages.length]);

  if (!activeChannelId) {
    return (
      <EmptyChannel />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-border/70 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Hash className="size-4 text-muted-foreground" aria-hidden />
          <h1 className="text-base font-semibold leading-none tracking-tight">
            {channel?.name ?? 'channel'}
          </h1>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {activeDecisionId ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                <Pin className="size-3" aria-hidden />
                Pinned decision
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" aria-hidden /> {messages.length} events
            </span>
          </div>
        </div>
        {channel?.topic ? (
          <p className="mt-1 truncate text-xs text-muted-foreground/80">
            {channel.topic}
          </p>
        ) : null}
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 scrollbar-sleek">
        <div className="flex flex-col py-1">
          {eventsRes.loading ? (
            <ChatSkeleton />
          ) : messages.length === 0 ? (
            <EmptyMessages />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenDecision={(id) => setActiveDecision(id)}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Composer */}
      <TypedComposer channelId={activeChannelId} />
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyMessages() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
      <span className="text-base font-medium text-foreground">
        No messages yet
      </span>
      <span>This channel is empty. Post the first message below.</span>
    </div>
  );
}

function EmptyChannel() {
  const { setView, setActiveChannel } = useAppStore();
  const channelsRes = useFetch<ChannelsResponse>('/api/channels');
  const channels = channelsRes.data?.channels ?? [];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="text-base font-medium">No channel selected</span>
      <p className="text-sm text-muted-foreground">
        Pick a channel from the left rail, or jump to a different view.
      </p>
      {channels.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            const first = channels[0];
            if (first) {
              setActiveChannel(first.id);
            }
          }}
          className="text-sm text-primary hover:underline"
        >
          Open #{channels[0]?.name}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setView('ledger')}
          className="text-sm text-primary hover:underline"
        >
          Open the ledger instead
        </button>
      )}
    </div>
  );
}
