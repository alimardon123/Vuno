'use client';

// Watch one conversation for anything appended to it, and re-render when there
// is. The page renders from the server, so the refresh is the update: there is
// no second, client-side copy of a conversation to drift from the one the
// server sent — which is the divergence the old shell had in four places.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function useConversationStream(conversationId: string, latestSeq: number, enabled = true) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled || !conversationId) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let cursor = latestSeq;
    let closedByUs = false;
    // Backs off so a server that is down is not hammered by every open tab.
    let backoff = 1_000;

    const connect = () => {
      if (closedByUs) return;
      source = new EventSource(`/api/stream?scopeId=${encodeURIComponent(conversationId)}&afterSeq=${cursor}`);

      source.addEventListener('cursor', (e) => {
        backoff = 1_000;
        const data = parse(e);
        if (typeof data?.seq === 'number') cursor = data.seq;
      });

      source.addEventListener('appended', (e) => {
        const data = parse(e);
        if (typeof data?.seq === 'number') cursor = data.seq;
        router.refresh();
      });

      // The server closes a long-lived connection on purpose; reconnecting from
      // the cursor loses nothing, because the spine is ordered.
      source.addEventListener('bye', () => {
        source?.close();
        source = null;
        retry = setTimeout(connect, 250);
      });

      source.onerror = () => {
        source?.close();
        source = null;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      };
    };

    connect();

    return () => {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [conversationId, latestSeq, enabled, router]);
}

function parse(e: Event): { seq?: number } | null {
  try {
    return JSON.parse((e as MessageEvent<string>).data) as { seq?: number };
  } catch {
    return null;
  }
}
