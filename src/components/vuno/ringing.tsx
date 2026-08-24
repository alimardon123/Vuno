'use client';

// Somebody is calling you, and you are reading something else.
//
// This is the whole difference between a call and a notice. A call button that
// only reaches people who happen to have that conversation open is a notice
// with a phone icon — so this sits in the app shell, above every surface, and
// follows you between them.
//
// Channels deliberately do not appear here. A channel call announces itself in
// the channel; a channel with two hundred members interrupting all of them
// because a working group started talking is the thing this split prevents
// (src/lib/calls/index.ts).

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/vuno/primitives';

interface Ring {
  callId: string;
  channelId: string;
  conversationName: string;
  from: string;
  since: string;
}

/**
 * How often to ask.
 *
 * Four seconds is the compromise: a ring that takes eight seconds to appear has
 * already been given up on, and one second is a query per second per open tab
 * for something that happens twice a day.
 */
const POLL_MS = 4_000;

export function Ringing() {
  const [rings, setRings] = useState<Ring[]>([]);
  // Dismissed by call id, not by conversation: declining this call should not
  // silence the next one from the same person.
  const dismissed = useRef<Set<string>>(new Set());
  const router = useRouter();

  useEffect(() => {
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch('/api/calls/ringing');
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean; ringing?: Ring[] };
        if (stopped || !data.ok) return;
        const live = (data.ringing ?? []).filter((r) => !dismissed.current.has(r.callId));
        setRings(live);
        // A call that ended clears its dismissal, so the set cannot grow for as
        // long as the tab is open.
        const alive = new Set((data.ringing ?? []).map((r) => r.callId));
        for (const id of dismissed.current) if (!alive.has(id)) dismissed.current.delete(id);
      } catch {
        // Offline, or the server restarted. Try again on the next tick.
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (rings.length === 0) return null;

  return (
    <div
      // Announced, not just drawn: somebody who cannot see the corner of the
      // screen still needs to know the phone is going.
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4"
    >
      <ul className="flex w-full max-w-[24rem] flex-col gap-1.5">
        {rings.map((r) => (
          <li
            key={r.callId}
            className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-line-2 bg-[var(--raised)] px-3 py-2.5 shadow-xl"
          >
            <span className="relative shrink-0">
              <Avatar name={r.from} kind="human" size="md" />
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 animate-pulse rounded-full bg-[var(--tested)] ring-2 ring-[var(--raised)]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-[var(--fg)]">{r.from} is calling</p>
              <p className="truncate text-[11px] text-[var(--fg-3)]">{r.conversationName}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                dismissed.current.add(r.callId);
                setRings((prev) => prev.filter((x) => x.callId !== r.callId));
              }}
              className="shrink-0 rounded-md border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)]"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => {
                setRings((prev) => prev.filter((x) => x.callId !== r.callId));
                // The conversation is where the call surface lives, so joining
                // is going there — one place a call can be, not two.
                router.push(`/chats/${r.channelId}?join=1`);
              }}
              className="shrink-0 rounded-md bg-[var(--tested)] px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Join
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
