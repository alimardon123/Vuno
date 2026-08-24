'use client';

// The composer.
//
// It used to offer Objection / Evidence / Proposal tabs. Picking one changed
// the placeholder and nothing else: every send posted a plain MessagePosted,
// because all three of those events carry a `decisionId` and a conversation has
// no decision to attach them to (src/lib/events/types.ts). A control that
// claims to change what you are recording and does not is exactly the scripted
// theatre CLAUDE.md rules out.
//
// What is here instead is what people actually reach for, and each control does
// the thing it says:
//
//   attach   drag a file onto the conversation, paste a screenshot, or pick one
//   record   a voice note, with the length shown before you send it
//   format   bold, italic, code, a fenced block, a link — markdown, rendered
//   @        mention someone, from the handles that exist
//   emoji    a picker, keyboard-first
//
// Drafts survive navigation, because losing a half-written message when you
// click away to check something is the single most annoying thing a chat app
// can do.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { StoredAttachment } from '@/lib/attachments';
import { Avatar } from '@/components/vuno/primitives';
import { EmojiPicker } from '@/components/vuno/emoji-picker';

export interface Mentionable {
  id: string;
  handle: string;
  displayName: string;
  kind: 'human' | 'agent';
  roleLabel: string | null;
}

/** What a pending upload looks like while it is still going up. */
interface Pending {
  localId: string;
  name: string;
  bytes: number;
  progress: number;
  error: string | null;
  stored: StoredAttachment | null;
}

const MAX_FILES = 10;

function draftKey(conversationId: string): string {
  return `vuno-draft:${conversationId}`;
}

export function Composer({
  conversationId,
  conversationName,
  mentionable = [],
}: {
  conversationId: string;
  conversationName: string;
  /** Everyone `@` can reach here. Deterministic, not a guess at the text. */
  mentionable?: Mentionable[];
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [mention, setMention] = useState<{ query: string; from: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState<{ startedAt: number; seconds: number } | null>(null);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const router = useRouter();
  const { toast } = useToast();

  // ── Drafts ────────────────────────────────────────────────────────────────
  // Restored per conversation, so switching back to a thread you were halfway
  // through finds what you wrote. Attachments are deliberately not restored:
  // the upload is real and the file is on the server, but a draft that silently
  // re-attaches something you thought you had abandoned is worse than losing it.
  useEffect(() => {
    try {
      setBody(window.localStorage.getItem(draftKey(conversationId)) ?? '');
    } catch {
      setBody('');
    }
    setFiles([]);
    setMention(null);
  }, [conversationId]);

  useEffect(() => {
    try {
      if (body) window.localStorage.setItem(draftKey(conversationId), body);
      else window.localStorage.removeItem(draftKey(conversationId));
    } catch {
      // A browser refusing storage is not a reason to stop typing.
    }
  }, [body, conversationId]);

  // ── Growing with the text ─────────────────────────────────────────────────
  // A fixed two rows means a long message is composed through a slot. Capped,
  // because a composer that eats the conversation is the other failure.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [body]);

  const ready = files.filter((f) => f.stored).map((f) => f.stored as StoredAttachment);
  const uploading = files.some((f) => !f.stored && !f.error);
  const canSend = (body.trim().length > 0 || ready.length > 0) && !busy && !uploading;

  // ── Uploading ─────────────────────────────────────────────────────────────
  const upload = useCallback(
    async (file: File, durationMs?: number) => {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setFiles((prev) =>
        prev.length >= MAX_FILES
          ? prev
          : [...prev, { localId, name: file.name, bytes: file.size, progress: 0, error: null, stored: null }],
      );

      const form = new FormData();
      form.append('file', file);
      form.append('channelId', conversationId);
      if (durationMs) form.append('durationMs', String(Math.round(durationMs)));

      // XHR rather than fetch: `fetch` has no upload progress, and a 20 MB file
      // going up with no feedback is indistinguishable from a hung app.
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/uploads');
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const progress = e.loaded / e.total;
          setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, progress } : f)));
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText) as { ok?: boolean; error?: string; attachment?: StoredAttachment };
            if (xhr.status >= 200 && xhr.status < 300 && data.attachment) {
              setFiles((prev) =>
                prev.map((f) => (f.localId === localId ? { ...f, progress: 1, stored: data.attachment ?? null } : f)),
              );
            } else {
              setFiles((prev) =>
                prev.map((f) => (f.localId === localId ? { ...f, error: data.error ?? 'Upload failed' } : f)),
              );
            }
          } catch {
            setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, error: 'Upload failed' } : f)));
          }
          resolve();
        };
        xhr.onerror = () => {
          setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, error: 'Upload failed' } : f)));
          resolve();
        };
        xhr.send(form);
      });
    },
    [conversationId],
  );

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list);
      const room = MAX_FILES - files.length;
      if (incoming.length > room) {
        toast({
          title: `${MAX_FILES} files to a message`,
          description: `Sending the first ${room}. Post the rest separately.`,
        });
      }
      for (const f of incoming.slice(0, Math.max(room, 0))) void upload(f);
    },
    [files.length, toast, upload],
  );

  async function discard(f: Pending) {
    setFiles((prev) => prev.filter((x) => x.localId !== f.localId));
    if (f.stored) {
      await fetch(`/api/uploads?id=${encodeURIComponent(f.stored.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // ── Voice notes ───────────────────────────────────────────────────────────
  async function startRecording() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast({ title: 'No microphone here', description: 'This browser will not give the page one.', variant: 'destructive' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        // Stop the track, or the browser keeps showing a recording indicator
        // long after the composer has forgotten about it.
        for (const track of stream.getTracks()) track.stop();
      };
      rec.start();
      recorder.current = rec;
      setRecording({ startedAt: Date.now(), seconds: 0 });
    } catch {
      toast({
        title: 'Microphone refused',
        description: 'The browser blocked it, or another app has it.',
        variant: 'destructive',
      });
    }
  }

  function stopRecording(send: boolean) {
    const rec = recorder.current;
    const started = recording?.startedAt;
    recorder.current = null;
    setRecording(null);
    if (!rec) return;

    rec.addEventListener(
      'stop',
      () => {
        if (!send || chunks.current.length === 0) {
          chunks.current = [];
          return;
        }
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        chunks.current = [];
        const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
        void upload(new File([blob], `voice-note-${stamp}.webm`, { type: blob.type }), started ? Date.now() - started : undefined);
      },
      { once: true },
    );
    rec.stop();
  }

  // The clock for the recording chip. One interval, cleared with the recording.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setRecording((r) => (r ? { ...r, seconds: Math.floor((Date.now() - r.startedAt) / 1000) } : r));
    }, 250);
    return () => clearInterval(t);
  }, [recording?.startedAt]);

  // ── Mentions ──────────────────────────────────────────────────────────────
  // Driven from the caret, against handles that exist. The old code matched
  // keywords in the body; this matches what you are typing, where you are.
  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return mentionable
      .filter((m) => m.handle.toLowerCase().startsWith(q) || m.displayName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, mentionable]);

  function syncMention(value: string, caret: number) {
    const upto = value.slice(0, caret);
    // Only at a word boundary: an email address is not a mention.
    const m = /(?:^|[^\w@/])@([a-z0-9._-]*)$/i.exec(upto);
    if (!m) {
      setMention(null);
      return;
    }
    setMention({ query: m[1], from: caret - m[1].length - 1 });
    setMentionIndex(0);
  }

  function applyMention(handle: string) {
    if (!mention) return;
    const el = textarea.current;
    const caret = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.from)}@${handle} ${body.slice(caret)}`;
    setBody(next);
    setMention(null);
    requestAnimationFrame(() => {
      const at = mention.from + handle.length + 2;
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  }

  // ── Formatting ────────────────────────────────────────────────────────────
  // Wraps the selection, or opens the marks and puts the caret between them —
  // the behaviour every editor has, and the reason a toolbar is usable at all.
  function wrap(before: string, after = before, placeholder = '') {
    const el = textarea.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.slice(start, end) || placeholder;
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function insert(text: string) {
    const el = textarea.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${text}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  async function submit() {
    if (!canSend) return;
    setBusy(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: conversationId,
          body: body.trim(),
          attachmentIds: ready.map((a) => a.id),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Could not send');
      setBody('');
      setFiles([]);
      try {
        window.localStorage.removeItem(draftKey(conversationId));
      } catch {
        /* storage refused; the message still went */
      }
      router.refresh();
    } catch (e) {
      toast({
        title: 'Not sent',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="shrink-0 px-4 pb-3 pt-1"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer actually left, not when it crossed a child.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
      }}
    >
      <div
        className={cn(
          'relative rounded-lg border bg-[var(--surface)] transition-colors',
          dragging ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] focus-within:border-line-2',
        )}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-lg text-[12px] font-medium text-[var(--fg-2)]">
            Drop to attach
          </div>
        ) : null}

        {files.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 border-b border-[var(--line)] px-2.5 py-2">
            {files.map((f) => (
              <li
                key={f.localId}
                className={cn(
                  'flex min-w-0 max-w-[15rem] items-center gap-1.5 rounded-md border px-1.5 py-1',
                  f.error ? 'border-falsified bg-[var(--falsified-bg)]' : 'border-[var(--line)] bg-[var(--sunken)]',
                )}
              >
                <span className="truncate text-[11px] text-[var(--fg-2)]">{f.name}</span>
                {f.error ? (
                  <span className="shrink-0 text-[10px] text-[var(--falsified)]">{f.error}</span>
                ) : f.stored ? (
                  <span className="shrink-0 text-[10px] text-[var(--fg-4)]">{formatBytes(f.bytes)}</span>
                ) : (
                  <span className="tnum shrink-0 text-[10px] text-[var(--fg-4)]">{Math.round(f.progress * 100)}%</span>
                )}
                <button
                  type="button"
                  onClick={() => void discard(f)}
                  aria-label={`Remove ${f.name}`}
                  className="shrink-0 rounded px-0.5 text-[var(--fg-4)] transition-colors hover:text-[var(--fg)]"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {matches.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Mention someone"
            className="absolute bottom-full left-0 z-20 mb-1 w-[19rem] overflow-hidden rounded-lg border border-line-2 bg-[var(--raised)] shadow-lg"
          >
            {matches.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(m.handle);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors',
                    i === mentionIndex ? 'bg-[var(--select)]' : 'hover:bg-[var(--hover)]',
                  )}
                >
                  <Avatar name={m.displayName} kind={m.kind} size="xs" />
                  <span className="truncate text-[12px] font-medium text-[var(--fg)]">{m.displayName}</span>
                  <span className="truncate font-mono text-[11px] text-[var(--fg-4)]">@{m.handle}</span>
                  {m.roleLabel ? (
                    <span className="ml-auto shrink-0 text-[10px] text-[var(--fg-4)]">{m.roleLabel}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={textarea}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            syncMention(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => syncMention(body, e.currentTarget.selectionStart)}
          onPaste={(e) => {
            // A screenshot on the clipboard arrives as a file with no name.
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length > 0) {
              e.preventDefault();
              addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (matches.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % matches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((i) => (i - 1 + matches.length) % matches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                applyMention(matches[mentionIndex].handle);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
            // The shortcuts every editor has. Without them the toolbar is the
            // only way, and nobody uses a toolbar twice.
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
              if (e.key === 'b') {
                e.preventDefault();
                wrap('**', '**', 'bold');
              }
              if (e.key === 'i') {
                e.preventDefault();
                wrap('_', '_', 'italic');
              }
              if (e.key === 'e') {
                e.preventDefault();
                wrap('`', '`', 'code');
              }
            }
          }}
          rows={2}
          placeholder={`Message ${conversationName}…`}
          aria-label={`Message ${conversationName}`}
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-[1.5] text-[var(--fg)] placeholder:text-[var(--fg-4)] focus:outline-none"
        />

        <div className="flex items-center gap-0.5 px-2 pb-2">
          {recording ? (
            <div className="flex items-center gap-2 pl-1">
              <span className="size-2 animate-pulse rounded-full bg-[var(--falsified)]" aria-hidden />
              <span className="tnum text-[11.5px] font-medium text-[var(--fg)]">
                {Math.floor(recording.seconds / 60)}:{String(recording.seconds % 60).padStart(2, '0')}
              </span>
              <Tool label="Discard recording" onClick={() => stopRecording(false)}>
                Discard
              </Tool>
              <Tool label="Attach recording" onClick={() => stopRecording(true)}>
                Stop
              </Tool>
            </div>
          ) : (
            <>
              <label
                className="grid size-7 cursor-pointer place-items-center rounded-md text-[var(--fg-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-within:bg-[var(--hover)]"
                title="Attach a file"
              >
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label="Attach a file"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <PaperclipIcon />
              </label>

              <Tool label="Record a voice note" onClick={() => void startRecording()}>
                <MicIcon />
              </Tool>

              <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden />

              <Tool label="Bold" onClick={() => wrap('**', '**', 'bold')}>
                <span className="text-[12px] font-bold">B</span>
              </Tool>
              <Tool label="Italic" onClick={() => wrap('_', '_', 'italic')}>
                <span className="text-[12px] font-serif italic">I</span>
              </Tool>
              <Tool label="Inline code" onClick={() => wrap('`', '`', 'code')}>
                <span className="font-mono text-[11px]">{'</>'}</span>
              </Tool>
              <Tool label="Code block" onClick={() => insert('\n```\n\n```\n')}>
                <span className="font-mono text-[11px]">{'{ }'}</span>
              </Tool>
              <Tool label="Link" onClick={() => wrap('[', '](https://)', 'text')}>
                <LinkIcon />
              </Tool>
              <Tool label="Quote" onClick={() => insert('\n> ')}>
                <span className="text-[13px] leading-none">&ldquo;</span>
              </Tool>

              <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden />

              <div className="relative">
                <Tool label="Emoji" onClick={() => setEmojiOpen((v) => !v)} pressed={emojiOpen}>
                  <span className="text-[13px] leading-none">☺</span>
                </Tool>
                {emojiOpen ? (
                  <EmojiPicker
                    onPick={(emoji) => {
                      insert(emoji);
                      setEmojiOpen(false);
                    }}
                    onClose={() => setEmojiOpen(false)}
                  />
                ) : null}
              </div>
            </>
          )}

          <span className="ml-auto pr-1.5 text-[10.5px] text-[var(--fg-4)]">
            {uploading ? 'Uploading…' : '⌘↵ to send'}
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            className={cn(
              'rounded-md px-3 py-1 text-[11.5px] font-semibold transition-opacity',
              'bg-[var(--accent)] text-[var(--accent-fg)]',
              !canSend && 'cursor-not-allowed opacity-40',
            )}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tool({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
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
        'grid size-7 place-items-center rounded-md text-[var(--fg-3)] transition-colors',
        'hover:bg-[var(--hover)] hover:text-[var(--fg)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        pressed && 'bg-[var(--select)] text-[var(--fg)]',
      )}
    >
      {children}
    </button>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const I = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PaperclipIcon() {
  return (
    <svg {...I}>
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.4-7.4" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg {...I}>
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg {...I}>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7" />
    </svg>
  );
}
