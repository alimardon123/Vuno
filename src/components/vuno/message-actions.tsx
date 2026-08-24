'use client';

// What you can do to a message, and what has already been done to it.
//
// The toolbar appears on hover *and* on keyboard focus. Hover-only strands
// anyone using a keyboard; always-on turns a conversation into a wall of
// buttons. Both, the same rule the roster already follows.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { EmojiPicker } from '@/components/vuno/emoji-picker';
import type { Reaction } from '@/lib/messages/actions';

/** The two or three people actually reach for. The picker holds the rest. */
const QUICK = ['👍', '✅', '👀'];

export interface ActOn {
  channelId: string;
  targetEventId: string;
  /** Whether the viewer wrote it — edit and delete are the author's alone. */
  mine: boolean;
  pinned: boolean;
  /** The text, for the editor to start from. */
  body: string;
}

async function post(payload: unknown): Promise<void> {
  const res = await fetch('/api/messages/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'That did not work');
}

export function MessageToolbar({
  on,
  onReply,
  onEdit,
  canReply = true,
}: {
  on: ActOn;
  onReply: () => void;
  onEdit: () => void;
  /**
   * False inside a threaded channel, where the thread has one reply button of
   * its own. Two buttons doing the same thing on the same post is worse than
   * either — and a reply to a reply would open a second level of nesting that
   * the channel does not render.
   */
  canReply?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function run(payload: unknown) {
    try {
      await post(payload);
      router.refresh();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
    }
  }

  return (
    <div
      className={cn(
        'absolute -top-3 right-3 z-10 flex items-center gap-0.5 rounded-md border border-line-2 bg-[var(--raised)] p-0.5 shadow-sm',
        'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
      )}
    >
      {QUICK.map((emoji) => (
        <Act
          key={emoji}
          label={`React ${emoji}`}
          onClick={() => void run({ action: 'react', channelId: on.channelId, targetEventId: on.targetEventId, emoji, on: true })}
        >
          <span className="text-[13px] leading-none">{emoji}</span>
        </Act>
      ))}

      <div className="relative">
        <Act label="React with…" onClick={() => setPicking((v) => !v)} pressed={picking}>
          <PlusEmojiIcon />
        </Act>
        {picking ? (
          <EmojiPicker
            onPick={(emoji) => {
              setPicking(false);
              void run({ action: 'react', channelId: on.channelId, targetEventId: on.targetEventId, emoji, on: true });
            }}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </div>

      <span className="mx-0.5 h-4 w-px bg-[var(--line)]" aria-hidden />

      {canReply ? (
        <Act label="Reply" onClick={onReply}>
          <ReplyIcon />
        </Act>
      ) : null}
      <Act
        label={on.pinned ? 'Unpin' : 'Pin'}
        pressed={on.pinned}
        onClick={() => void run({ action: 'pin', channelId: on.channelId, targetEventId: on.targetEventId, on: !on.pinned })}
      >
        <PinIcon />
      </Act>

      {on.mine ? (
        <>
          <Act label="Edit" onClick={onEdit}>
            <PencilIcon />
          </Act>
          <Act label="Delete" onClick={() => setConfirming(true)} destructive>
            <TrashIcon />
          </Act>
        </>
      ) : null}

      {confirming ? (
        <ConfirmDelete
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run({ action: 'delete', channelId: on.channelId, targetEventId: on.targetEventId });
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmDelete({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) onCancel();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onCancel]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Delete this message?"
      className="absolute right-0 top-full z-30 mt-1 w-[17rem] rounded-lg border border-line-2 bg-[var(--raised)] p-2.5 shadow-lg"
    >
      <p className="mb-2 text-[11.5px] leading-[1.5] text-[var(--fg-2)]">
        The message stops being shown and its place in the conversation stays, so replies to it still make sense.
        What was posted remains on the record.
      </p>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)]"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md border border-falsified bg-[var(--falsified-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--falsified)] transition-opacity hover:opacity-85"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** The reactions standing on a message, and a way to add to them. */
export function Reactions({
  reactions,
  channelId,
  targetEventId,
}: {
  reactions: Reaction[];
  channelId: string;
  targetEventId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  if (reactions.length === 0) return null;

  async function toggle(r: Reaction) {
    try {
      await post({ action: 'react', channelId, targetEventId, emoji: r.emoji, on: !r.mine });
      router.refresh();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
    }
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => void toggle(r)}
          // Names, not a count alone. "3" tells you how many; "Mira, Peri and
          // Sam" tells you whether the person you were waiting on has seen it.
          title={`${r.by.map((m) => m.displayName).join(', ')} reacted ${r.emoji}`}
          aria-pressed={r.mine}
          aria-label={`${r.emoji}, ${r.by.length} ${r.by.length === 1 ? 'person' : 'people'}${r.mine ? ', including you' : ''}`}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
            r.mine
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--fg)]'
              : 'border-[var(--line)] bg-[var(--sunken)] text-[var(--fg-2)] hover:border-line-2',
          )}
        >
          <span className="text-[12px] leading-none">{r.emoji}</span>
          <span className="tnum text-[10.5px]">{r.by.length}</span>
        </button>
      ))}
    </div>
  );
}

/** Editing in place. The message keeps its position while you rewrite it. */
export function InlineEditor({
  channelId,
  targetEventId,
  initial,
  onDone,
}: {
  channelId: string;
  targetEventId: string;
  initial: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    // Caret at the end, not the start — you are almost always adding to it or
    // fixing the last word.
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  async function save() {
    const body = text.trim();
    if (!body || body === initial.trim()) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await post({ action: 'edit', channelId, targetEventId, body });
      router.refresh();
      onDone();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="my-1 max-w-[78ch] overflow-hidden rounded-md border border-[var(--accent)] bg-[var(--surface)]">
      <textarea
        ref={area}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onDone();
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        aria-label="Edit this message"
        className="w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-[1.5] text-[var(--fg)] focus:outline-none"
      />
      <div className="flex items-center gap-2 px-2 pb-1.5">
        <span className="text-[10.5px] text-[var(--fg-4)]">Escape to cancel · ⌘↵ to save</span>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto rounded-md border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-md bg-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Act({
  label,
  onClick,
  pressed,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'grid size-6 place-items-center rounded text-[var(--fg-3)] transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        destructive ? 'hover:bg-[var(--falsified-bg)] hover:text-[var(--falsified)]' : 'hover:bg-[var(--hover)] hover:text-[var(--fg)]',
        pressed && 'bg-[var(--select)] text-[var(--fg)]',
      )}
    >
      {children}
    </button>
  );
}

const I = {
  width: 13,
  height: 13,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function ReplyIcon() {
  return <svg {...I}><path d="M9 10 4 15l5 5" /><path d="M4 15h10a6 6 0 0 0 6-6V5" /></svg>;
}
function PinIcon() {
  return <svg {...I}><path d="M12 17v5" /><path d="M9 3h6l-1 6 3.5 3.5V15H6.5v-2.5L10 9z" /></svg>;
}
function PencilIcon() {
  return <svg {...I}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" /></svg>;
}
function TrashIcon() {
  return <svg {...I}><path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13" /></svg>;
}
function PlusEmojiIcon() {
  return (
    <svg {...I}>
      <path d="M20.5 12A8.5 8.5 0 1 1 12 3.5" />
      <path d="M8.5 14a4.5 4.5 0 0 0 6.2.8" />
      <path d="M9 9.5h.01M14.5 9.5h.01" />
      <path d="M18 3v5M15.5 5.5h5" />
    </svg>
  );
}
