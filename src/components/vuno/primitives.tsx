// Vuno — the pieces every surface reuses.
//
// Two rules encoded here rather than repeated in every view:
//   1. A member renders the same way whether they are a person or an agent.
//      The only difference is avatar shape and a chip (ADR-0009).
//   2. Status colour is the only saturated colour on screen.

import { cn } from '@/lib/utils';

// ─── Presence ────────────────────────────────────────────────────────────────
// One vocabulary for every member. An agent's is written by the orchestrator; a
// person sets theirs. Same field, same rendering.

export type PresenceState = 'available' | 'busy' | 'away' | 'offline' | 'dnd';

const PRESENCE_COLOR: Record<PresenceState, string> = {
  available: 'bg-[var(--tested)]',
  busy: 'bg-[var(--asserted)]',
  away: 'bg-[var(--uncertain)]',
  offline: 'bg-transparent border border-[var(--line-2)]',
  dnd: 'bg-[var(--falsified)]',
};

const PRESENCE_LABEL: Record<PresenceState, string> = {
  available: 'Available',
  busy: 'Busy',
  away: 'Away',
  offline: 'Offline',
  dnd: 'Do not disturb',
};

export function PresenceDot({
  state,
  className,
  ring = 'var(--surface)',
}: {
  state: PresenceState;
  className?: string;
  ring?: string;
}) {
  return (
    <span
      className={cn('block size-[7px] shrink-0 rounded-full', PRESENCE_COLOR[state], className)}
      style={{ boxShadow: `0 0 0 1.5px ${ring}` }}
      aria-label={PRESENCE_LABEL[state]}
      title={PRESENCE_LABEL[state]}
    />
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
// Humans get a circle, agents a squircle. One shape difference carries the
// distinction that a repeated "agent" badge on every row used to carry badly.

export type MemberKind = 'human' | 'agent';

const SIZES = { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-7 text-[11px]', lg: 'size-9 text-[13px]' };

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  kind = 'human',
  size = 'sm',
  presence,
  className,
}: {
  name: string;
  kind?: MemberKind;
  size?: keyof typeof SIZES;
  presence?: PresenceState;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-grid place-items-center font-semibold select-none',
          'bg-[var(--sunken)] text-[var(--fg-2)] border border-[var(--line)]',
          kind === 'agent' ? 'rounded-[7px]' : 'rounded-full',
          SIZES[size],
        )}
        aria-hidden
      >
        {initialsOf(name)}
      </span>
      {presence ? (
        <span className="absolute -right-0.5 -bottom-0.5">
          <PresenceDot state={presence} />
        </span>
      ) : null}
    </span>
  );
}

// ─── Member label ────────────────────────────────────────────────────────────
// An assistant renders as itself, with the chip that says whose it is — never as
// its owner (ADR-0009 §1).

export function MemberName({
  name,
  kind,
  chip,
  className,
}: {
  name: string;
  kind: MemberKind;
  /** e.g. "Kai's assistant", "Architect", "owner" */
  chip?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-baseline gap-1.5', className)}>
      <span className="truncate font-semibold tracking-[-0.006em] text-[var(--fg)]">{name}</span>
      {chip ? (
        <span
          className={cn(
            'shrink-0 rounded-[4px] px-1 py-px text-[10px] font-medium leading-[1.35]',
            'bg-[var(--sunken)] text-[var(--fg-3)] border border-[var(--line)]',
          )}
        >
          {chip}
        </span>
      ) : null}
      <span className="sr-only">{kind === 'agent' ? ' (agent)' : ' (person)'}</span>
    </span>
  );
}

// ─── Claim status ────────────────────────────────────────────────────────────
// The only saturated colour in the interface.

export type ClaimStatus = 'asserted' | 'believed' | 'tested' | 'falsified' | 'uncertain';

const STATUS_STYLE: Record<ClaimStatus, string> = {
  asserted: 'bg-[var(--asserted-bg)] text-[var(--asserted)]',
  believed: 'bg-[var(--believed-bg)] text-[var(--believed)]',
  tested: 'bg-[var(--tested-bg)] text-[var(--tested)]',
  falsified: 'bg-[var(--falsified-bg)] text-[var(--falsified)]',
  uncertain: 'bg-[var(--uncertain-bg)] text-[var(--uncertain)]',
};

export function StatusPill({
  status,
  className,
  children,
}: {
  status: ClaimStatus;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      // A hook for the directions: Ledger sets status as a marginal note
      // rather than a filled chip, and it needs something to key off that is
      // not a utility class (globals.css).
      data-status-pill={status}
      className={cn(
        'inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5',
        'text-[10px] font-bold uppercase tracking-[0.055em] leading-[1.4]',
        STATUS_STYLE[status],
        className,
      )}
    >
      {children ?? status}
    </span>
  );
}

/** The trail a claim took, oldest first. Prior states are quiet; the current one carries colour. */
export function StatusTrail({ trail, current }: { trail: ClaimStatus[]; current: ClaimStatus }) {
  return (
    <span className="inline-flex items-center gap-1">
      {trail.map((s, i) => (
        <span key={`${s}-${i}`} className="inline-flex items-center gap-1">
          <span className="rounded-[3px] bg-[var(--sunken)] px-1 py-px text-[9px] font-semibold uppercase tracking-[0.05em] text-[var(--fg-4)]">
            {s}
          </span>
          <span className="text-[9px] text-[var(--fg-4)]" aria-hidden>→</span>
        </span>
      ))}
      <StatusPill status={current} />
    </span>
  );
}

// ─── Gate verdict ────────────────────────────────────────────────────────────

export function GateChip({ state }: { state: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    passed: { cls: 'bg-[var(--tested-bg)] text-[var(--tested)]', label: 'Passed' },
    blocked: { cls: 'bg-[var(--falsified-bg)] text-[var(--falsified)]', label: 'Blocked' },
    pending: { cls: 'bg-[var(--asserted-bg)] text-[var(--asserted)]', label: 'Held' },
  };
  const v = map[state] ?? map.pending;
  return (
    <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.055em]', v.cls)}>
      {v.label}
    </span>
  );
}

// ─── Layout helpers ──────────────────────────────────────────────────────────

export function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--fg-4)]">{children}</span>
      {count !== undefined ? <span className="tnum ml-auto text-[10px] text-[var(--fg-4)]">{count}</span> : null}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-8 text-center">
      <p className="text-[13px] font-medium text-[var(--fg-2)]">{title}</p>
      {hint ? <p className="max-w-[42ch] text-[12px] leading-relaxed text-[var(--fg-3)]">{hint}</p> : null}
    </div>
  );
}

export function relativeTime(value: string | Date): string {
  const then = typeof value === 'string' ? new Date(value) : value;
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 45) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604_800) return `${Math.floor(secs / 86_400)}d`;
  // A fixed locale, not the reader's: the server and the browser resolve
  // `undefined` differently, and the mismatch is a hydration error.
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A relative timestamp, rendered safely across hydration.
 *
 * `relativeTime` reads the clock, so the server's answer and the browser's are
 * minutes apart by the time React hydrates — which React reports as a mismatch
 * and repairs by throwing the whole subtree away. The value is advisory and
 * self-correcting on the next render, so the one element is exempted rather
 * than the page being re-rendered over a minute's difference.
 */
export function RelativeTime({ value, className }: { value: string | Date; className?: string }) {
  return (
    <span className={className} suppressHydrationWarning>
      {relativeTime(value)}
    </span>
  );
}


/** Gate names are identifiers ('qa'), so they get labels rather than CSS capitalisation. */
export function gateLabel(name: string): string {
  const known: Record<string, string> = {
    qa: 'QA',
    security: 'Security',
    performance: 'Performance',
    release: 'Release',
    architecture: 'Architecture',
  };
  return known[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}
