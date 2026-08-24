'use client';

// An emoji picker, keyboard-first.
//
// Not the full Unicode set behind a search index nobody maintains: the ones
// people actually send in a working conversation, grouped, with a filter over
// the names. Roughly what a keyboard shortcut sheet is to a menu — the short
// list you reach for, not the exhaustive one you scroll.
//
// Every entry carries its own words, so filtering is a substring match rather
// than a shortcode dictionary that has to be kept in step with the glyphs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Entry {
  emoji: string;
  words: string;
}

const GROUPS: Array<{ label: string; entries: Entry[] }> = [
  {
    label: 'Reactions',
    entries: [
      { emoji: '👍', words: 'thumbs up yes agree approve' },
      { emoji: '👎', words: 'thumbs down no disagree' },
      { emoji: '✅', words: 'check done tick complete' },
      { emoji: '❌', words: 'cross no wrong failed' },
      { emoji: '🎉', words: 'party tada celebrate shipped' },
      { emoji: '🔥', words: 'fire hot great' },
      { emoji: '👀', words: 'eyes looking watching' },
      { emoji: '🙏', words: 'thanks please pray' },
      { emoji: '💯', words: 'hundred exactly agree' },
      { emoji: '🚀', words: 'rocket ship launch deploy' },
      { emoji: '⚡', words: 'zap fast performance' },
      { emoji: '🧠', words: 'brain thinking smart' },
    ],
  },
  {
    label: 'Feeling',
    entries: [
      { emoji: '😀', words: 'grin happy smile' },
      { emoji: '😂', words: 'laugh crying funny' },
      { emoji: '🙂', words: 'slight smile fine' },
      { emoji: '😅', words: 'sweat nervous laugh' },
      { emoji: '🤔', words: 'thinking hmm unsure' },
      { emoji: '😬', words: 'grimace awkward yikes' },
      { emoji: '😴', words: 'sleep tired bored' },
      { emoji: '🤯', words: 'mind blown shocked' },
      { emoji: '😭', words: 'sob crying sad' },
      { emoji: '😤', words: 'frustrated determined' },
      { emoji: '🥳', words: 'partying celebrate' },
      { emoji: '🫠', words: 'melting overwhelmed' },
    ],
  },
  {
    label: 'Work',
    entries: [
      { emoji: '📊', words: 'chart data metrics benchmark' },
      { emoji: '🐛', words: 'bug defect broken' },
      { emoji: '🔧', words: 'wrench fix tool' },
      { emoji: '📝', words: 'memo note write doc' },
      { emoji: '📌', words: 'pin important pinned' },
      { emoji: '🔒', words: 'lock security private' },
      { emoji: '⏱️', words: 'timer latency stopwatch' },
      { emoji: '🧪', words: 'test experiment lab' },
      { emoji: '🗂️', words: 'files folder organise' },
      { emoji: '🛑', words: 'stop blocked halt' },
      { emoji: '⚠️', words: 'warning risk careful' },
      { emoji: '💡', words: 'idea bulb suggestion' },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.entries);

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Close on Escape and on a click outside. Both, because either alone leaves a
  // way to be stuck with it open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return null;
    return ALL.filter((e) => e.words.includes(query));
  }, [q]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Emoji"
      className="absolute bottom-full left-0 z-30 mb-1 w-[17.5rem] overflow-hidden rounded-lg border border-line-2 bg-[var(--raised)] shadow-lg"
    >
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search…"
        aria-label="Search emoji"
        className="w-full border-b border-[var(--line)] bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--fg)] placeholder:text-[var(--fg-4)] focus:outline-none"
      />
      <div className="max-h-[15rem] overflow-y-auto p-1.5">
        {filtered ? (
          filtered.length > 0 ? (
            <Grid entries={filtered} onPick={onPick} />
          ) : (
            <p className="px-1 py-4 text-center text-[11.5px] text-[var(--fg-4)]">Nothing matches “{q}”.</p>
          )
        ) : (
          GROUPS.map((g) => (
            <div key={g.label} className="mb-1 last:mb-0">
              <p className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--fg-4)]">
                {g.label}
              </p>
              <Grid entries={g.entries} onPick={onPick} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Grid({ entries, onPick }: { entries: Entry[]; onPick: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-0.5">
      {entries.map((e) => (
        <button
          key={e.emoji}
          type="button"
          // The first word is the name; the rest are what people might type.
          aria-label={e.words.split(' ').slice(0, 2).join(' ')}
          title={e.words.split(' ').slice(0, 2).join(' ')}
          onMouseDown={(ev) => {
            ev.preventDefault();
            onPick(e.emoji);
          }}
          className={cn(
            'grid aspect-square place-items-center rounded-md text-[17px] leading-none transition-colors',
            'hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]',
          )}
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );
}
