// Vuno — Chat view
// Fetches /api/events?scopeType=channel&scopeId=<id>&project=true and renders
// the projected chat messages. Includes a typed composer.
// The channel header is clickable — opens a sheet showing shared links/files/media.
// Subscribes to realtime events via socket.io — new messages appear instantly.

'use client';

import { useMemo, useState, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { useRealtime } from '@/hooks/use-realtime';
import { MessageBubble } from '@/components/chat/message-bubble';
import { TypedComposer } from '@/components/chat/typed-composer';
import { ChannelDetailsContent } from '@/components/chat/channel-details-content';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useEffect, useRef } from 'react';
import { Hash, Users, Pin, ChevronRight, Wifi, WifiOff } from 'lucide-react';
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
  const [detailsOpen, setDetailsOpen] = useState(false);

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
    intervalMs: 10000, // slower poll (10s) — realtime is the primary transport now
  });

  // refetch when the chat nonce bumps (e.g. after posting a message)
  useEffect(() => {
    if (chatNonce > 0) {
      eventsRes.refetch();
    }
    // eventsRes.refetch is stable; we intentionally only depend on chatNonce
  }, [chatNonce, eventsRes]);

  // Realtime subscription — when a new event is broadcast for this channel,
  // prepend it to the messages list instantly (no waiting for poll).
  const handleEventAppended = useCallback((data: { channelId?: string; scopeType?: string; scopeId?: string; event: unknown }) => {
    // Only handle events for the active channel
    if (data.channelId && data.channelId !== activeChannelId) return;
    if (data.scopeType === 'channel' && data.scopeId !== activeChannelId) return;
    // Force a refetch to get the latest projection (simplest + correct approach;
    // in a later slice we can optimize by prepending the single event)
    eventsRes.refetch();
  }, [activeChannelId, eventsRes]);

  // Typing indicator state — which agents are currently "typing"
  const [typingAgents, setTypingAgents] = useState<Set<string>>(new Set());
  const handleTyping = useCallback((data: { channelId?: string; userId: string; isTyping: boolean }) => {
    if (data.channelId && data.channelId !== activeChannelId) return;
    setTypingAgents((prev) => {
      const next = new Set(prev);
      if (data.isTyping) next.add(data.userId);
      else next.delete(data.userId);
      return next;
    });
  }, [activeChannelId]);

  const { isConnected, subscribe, unsubscribe } = useRealtime({
    onEventAppended: handleEventAppended,
    onTyping: handleTyping,
  });

  // Subscribe to the active channel for realtime events
  useEffect(() => {
    if (activeChannelId) {
      subscribe(activeChannelId);
      return () => unsubscribe(activeChannelId);
    }
  }, [activeChannelId, subscribe, unsubscribe]);

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
      {/* Header — clickable to open the details sheet (shared items, members, etc.)
          Per the user's direction: like Teams — clicking the top panel shows shared things. */}
      <header
        className="group cursor-pointer border-b border-border/70 px-4 py-2.5 transition-colors hover:bg-accent/40"
        onClick={() => setDetailsOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setDetailsOpen(true);
          }
        }}
        aria-label={`Open details for ${channel?.name ?? 'chat'}`}
      >
        <div className="flex items-center gap-2">
          {/* Show avatar for DMs, hash for channels — per the user's direction */}
          {channel?.isDm ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[0.625rem] font-semibold">
              {(channel?.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <Hash className="size-4 text-muted-foreground" aria-hidden />
          )}
          <h1 className="text-base font-semibold leading-none tracking-tight">
            {channel?.name ?? 'chat'}
          </h1>
          <ChevronRight className="size-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground" aria-hidden />
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
            {/* Realtime connection indicator */}
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.625rem]"
              title={isConnected ? 'Real-time connected' : 'Real-time disconnected — using polling'}
              aria-label={isConnected ? 'Real-time connected' : 'Real-time disconnected'}
            >
              {isConnected ? (
                <Wifi className="size-3 text-primary" aria-hidden />
              ) : (
                <WifiOff className="size-3 text-muted-foreground/60" aria-hidden />
              )}
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
      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
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

      {/* Typing indicator — shows "X is typing..." when agents are responding */}
      {typingAgents.size > 0 ? (
        <div className="flex items-center gap-2 border-t border-border/40 px-4 py-1.5 text-xs text-muted-foreground">
          <span className="flex gap-0.5">
            <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
          </span>
          <span>
            {Array.from(typingAgents).length === 1
              ? 'agent is typing…'
              : `${Array.from(typingAgents).length} agents are typing…`}
          </span>
        </div>
      ) : null}

      {/* Composer */}
      <TypedComposer channelId={activeChannelId} />

      {/* Details sheet — shared links, files, media. Per the user's direction:
          clicking the top panel shows shared things (like Teams). */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full max-w-md p-0">
          <SheetTitle className="sr-only">{channel?.isDm ? 'Chat details' : 'Channel details'}</SheetTitle>
          {activeChannelId ? (
            <ChannelDetailsContent
              channelId={activeChannelId}
              channelName={channel?.name ?? 'chat'}
              channelTopic={channel?.topic}
              isChat={channel?.isDm ?? false}
            />
          ) : null}
        </SheetContent>
      </Sheet>
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
