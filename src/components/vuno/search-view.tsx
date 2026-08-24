'use client';

// Vuno — one field, everything the org said.
//
// The results are the list, so this surface has no second pane: the field and
// what it found are the whole page. It has a URL — `/search?q=…` — which is
// what makes a result something you can send to somebody, and what makes the
// first paint work before any JavaScript runs.
//
// Typing then updates the URL rather than holding the query in state alone, so
// Back goes back through what you searched for.

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Empty, RelativeTime, SectionLabel } from '@/components/vuno/primitives';
// From `shape`, not `@/lib/search`: that module imports Prisma, and a client
// component importing anything from it ships the query engine to the browser.
import { splitSnippet, type SearchResults } from '@/lib/search/shape';
import type { ConversationKind } from '@/lib/conversations';
import { cn } from '@/lib/utils';

/**
 * How long to wait after the last keystroke.
 *
 * A query is ~1 ms of index and a few ms of round trip, so this is not about
 * load — it is that results changing under a word you are half-way through
 * typing is harder to read than results that arrive when you pause.
 */
const SETTLE_MS = 180;

export function SearchView({ initial }: { initial: SearchResults }) {
  const [q, setQ] = useState(initial.query);
  const [results, setResults] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);

  // The field is the point of the page, so it has the caret on arrival —
  // including when you got here from the rail or ⌘K.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term === results.query) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
          if (!res.ok) return;
          const data = (await res.json()) as { ok?: boolean } & SearchResults;
          // A slow answer to an old query must not overwrite a newer one.
          if (data.ok && data.query === term) setResults(data);
        } catch {
          // Offline. The last results stay on screen rather than blanking.
        }
      })();
      // Shareable, and Back works. `replace` rather than `push` so one search
      // is one history entry instead of one per keystroke.
      start(() => router.replace(term ? `/search?q=${encodeURIComponent(term)}` : '/search', { scroll: false }));
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [q, results.query, router]);

  const nothing =
    results.query.length > 0 &&
    results.messages.length === 0 &&
    results.conversations.length === 0 &&
    results.members.length === 0;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-[var(--line)] px-4 py-3 md:px-6">
        <div className="relative mx-auto w-full max-w-[46rem]">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)]"
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"
          >
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={field}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQ('');
                e.currentTarget.focus();
              }
            }}
            type="search"
            placeholder="Search messages, channels and people"
            aria-label="Search"
            className={cn(
              'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2 pl-9 pr-3',
              'text-[13.5px] text-[var(--fg)] placeholder:text-[var(--fg-4)]',
              'focus:border-line-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
            )}
          />
        </div>
      </header>

      <div className="scroll-y min-h-0 flex-1">
        <div
          className="mx-auto w-full max-w-[46rem] px-4 py-4 md:px-6"
          // The count changes without the page moving, so a screen reader is
          // told rather than left to discover it.
          aria-busy={pending}
        >
          {results.query.length === 0 ? (
            <Empty
              title="Search everything you can read"
              hint="Messages, channels and people. Nothing in a conversation you are not in, and nothing anyone deleted."
            />
          ) : nothing ? (
            <Empty
              title={`Nothing matches “${results.query}”`}
              hint="Try one distinctive word — a name, an error, a filename. Every word you add narrows it."
            />
          ) : (
            <>
              <p className="sr-only" role="status">
                {results.messages.length} message{results.messages.length === 1 ? '' : 's'} found
              </p>

              {results.members.length > 0 ? (
                <section className="mb-5">
                  <SectionLabel count={results.members.length}>People</SectionLabel>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {results.members.map((m) => (
                      <li key={m.id}>
                        <a
                          href={`/members?member=${m.id}`}
                          className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2 py-1.5 transition-colors hover:bg-[var(--hover)]"
                        >
                          <Avatar name={m.displayName} kind={m.kind} size="sm" />
                          <span className="text-[12.5px] font-medium text-[var(--fg)]">{m.displayName}</span>
                          <span className="text-[11px] text-[var(--fg-4)]">@{m.handle}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {results.conversations.length > 0 ? (
                <section className="mb-5">
                  <SectionLabel count={results.conversations.length}>Conversations</SectionLabel>
                  <ul className="mt-1 flex flex-col">
                    {results.conversations.map((c) => (
                      <li key={c.id}>
                        <a
                          href={hrefFor(c.kind, c.id)}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--hover)]"
                        >
                          <span className="text-[13px] leading-none text-[var(--fg-4)]">{glyph(c.kind)}</span>
                          <span className="text-[12.5px] font-medium text-[var(--fg)]">{c.name}</span>
                          {c.topic ? (
                            <span className="truncate text-[11px] text-[var(--fg-3)]">{c.topic}</span>
                          ) : null}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {results.messages.length > 0 ? (
                <section>
                  <SectionLabel count={results.messages.length}>Messages</SectionLabel>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {results.messages.map((m) => (
                      <li key={m.id}>
                        <a
                          // `before` is one past the hit, so the conversation
                          // opens with this message at the end of the window
                          // rather than at the live end of the stream. The
                          // route already reads it — a link into history is
                          // something the app could always do, and this is the
                          // first thing that needed it.
                          href={`${hrefFor(m.conversation.kind, m.conversation.id)}?before=${m.seq + 1}`}
                          className="flex flex-col gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--hover)]"
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-[12.5px] font-semibold text-[var(--fg)]">
                              {m.author?.displayName ?? 'System'}
                            </span>
                            <span className="text-[11px] text-[var(--fg-3)]">
                              in {glyph(m.conversation.kind)}
                              {m.conversation.name}
                            </span>
                            <span className="text-[11px] text-[var(--fg-4)]">
                              <RelativeTime value={m.at} />
                            </span>
                            {m.restrictedTo ? (
                              <span className="rounded border border-[var(--line)] px-1 text-[10px] uppercase tracking-[0.04em] text-[var(--fg-4)]">
                                {m.restrictedTo}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-[12.5px] leading-[1.5] text-[var(--fg-2)]">
                            {splitSnippet(m.snippet).map((part, i) =>
                              part.match ? (
                                <mark
                                  key={i}
                                  className="rounded-[3px] bg-[var(--mark)] px-[2px] font-medium text-[var(--mark-fg)]"
                                >
                                  {part.text}
                                </mark>
                              ) : (
                                <span key={i}>{part.text}</span>
                              ),
                            )}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                  {results.more ? (
                    <p className="mt-3 px-2 text-[11px] text-[var(--fg-4)]">
                      Showing the {results.messages.length} best matches. Add a word to narrow it.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function hrefFor(kind: ConversationKind, id: string): string {
  return kind === 'channel' || kind === 'team_room' ? `/channels/${id}` : `/chats/${id}`;
}

function glyph(kind: ConversationKind): string {
  return kind === 'channel' || kind === 'team_room' ? '#' : '';
}
