'use client';

// Scheduling a meeting, and the strip of what is coming up in a conversation.
//
// The time input is `datetime-local` rather than a hand-built picker. It is
// keyboard-operable, localised, and understood by every assistive technology
// without any of that being reimplemented — three things a custom calendar
// grid has to earn back before it is worth anything.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button, Dialog, Field, FormError, inputClass } from '@/components/vuno/dialog';
import type { MeetingRow } from '@/lib/meetings';

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function localValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The next round half hour — what somebody scheduling almost always means. */
function nextSlot(): Date {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
  return d;
}

export function ScheduleButton({ channelId, conversationName }: { channelId: string; conversationName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Schedule a meeting in ${conversationName}`}
        aria-label={`Schedule a meeting in ${conversationName}`}
        className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2 py-1 text-[11px] font-medium text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
      >
        <CalendarIcon />
        Schedule
      </button>
      {open ? <ScheduleDialog channelId={channelId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ScheduleDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [when, setWhen] = useState(localValue(nextSlot()));
  const [minutes, setMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          title,
          agenda: agenda || null,
          // The browser knows the reader's timezone; the server does not, so
          // the instant is computed here and sent as one.
          startsAt: new Date(when).toISOString(),
          minutes,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'That did not work');
      onClose();
      router.refresh();
      toast({ title: 'Scheduled', description: 'Everyone in this conversation can see it.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Schedule a meeting"
      hint="It happens here, in this conversation — the agenda, the messages before it and the call are in one place."
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="What it is about">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Benchmark review"
            autoFocus
          />
        </Field>
        <div className="flex gap-2">
          <Field label="When">
            <input type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="For">
            <select
              className={inputClass}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              aria-label="How long"
            >
              {[15, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Agenda" hint="Optional. Markdown, like anything else here.">
          <textarea
            className={`${inputClass} resize-y`}
            rows={3}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder={'- the 10k-reader result\n- what would change our minds'}
          />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** What is booked in this conversation, above the stream. */
export function MeetingStrip({
  meetings,
  onJoin,
}: {
  meetings: MeetingRow[];
  /** Joining is the call in this conversation — there is no separate room. */
  onJoin: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  if (meetings.length === 0) return null;

  async function callOff(m: MeetingRow) {
    try {
      const res = await fetch('/api/meetings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: m.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'That did not work');
      router.refresh();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'That did not work', variant: 'destructive' });
    }
  }

  return (
    <ul className="flex shrink-0 flex-col gap-1 border-b border-[var(--line)] bg-[var(--sunken)] px-4 py-2">
      {meetings.map((m) => (
        <li key={m.id} className="flex items-center gap-2">
          <CalendarIcon />
          <span className="truncate text-[11.5px] font-semibold text-[var(--fg)]">{m.title}</span>
          <span className="tnum shrink-0 text-[11px] text-[var(--fg-3)]">
            {new Date(m.startsAt).toLocaleString(undefined, {
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            · {m.minutes} min
          </span>
          {m.host ? <span className="shrink-0 text-[10.5px] text-[var(--fg-4)]">{m.host.displayName}</span> : null}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void callOff(m)}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-[var(--fg-4)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
            >
              Call off
            </button>
            <button
              type="button"
              onClick={onJoin}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors',
                m.live
                  ? 'bg-[var(--tested)] text-[var(--accent-fg)]'
                  : 'border border-[var(--line)] text-[var(--fg-3)] hover:bg-[var(--hover)]',
              )}
            >
              {m.live ? 'Join now' : 'Start early'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CalendarIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-[var(--fg-4)]"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
