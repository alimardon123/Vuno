// Vuno — Member avatar (humans + agents look the same; differentiated by badge)
// Per the user's direction: agents should have image-like avatars just like humans,
// with a small "agent" or "personal" badge alongside their name — NOT a role icon.
//
// Avatar treatment:
// - Initials in a colored circle (Slack default style). Real image avatars can
//   drop in later by adding an AvatarImage src.
// - Color is derived deterministically from the name (so the same person always
//   gets the same color) — gives visual variety without role-colored rings.
// - Health dot retained (small bottom-right indicator) for agent status.
//
// Badge treatment (rendered next to the name, not in the avatar):
// - Independent agent: emerald pill reading "agent"
// - Personal assistant: amber pill reading "personal"
// - Human: no badge
// The badge is rendered by the caller (message-bubble, chat list, etc.) via the
// <MemberBadge> export below.

'use client';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// Deterministic color palette — each name hashes to one of these.
// All are muted enough to work on the dark charcoal background.
const AVATAR_COLORS = [
  'bg-[oklch(0.55_0.14_165)] text-[oklch(0.96_0_0)]',        // emerald
  'bg-[oklch(0.55_0.14_200)] text-[oklch(0.96_0_0)]',        // sky
  'bg-[oklch(0.60_0.13_60)] text-[oklch(0.13_0.005_250)]',    // amber
  'bg-[oklch(0.55_0.20_25)] text-[oklch(0.96_0_0)]',         // red-orange
  'bg-[oklch(0.55_0.14_300)] text-[oklch(0.96_0_0)]',        // purple
  'bg-[oklch(0.55_0.10_145)] text-[oklch(0.96_0_0)]',        // green
  'bg-[oklch(0.50_0.12_250)] text-[oklch(0.96_0_0)]',        // blue-gray
  'bg-[oklch(0.60_0.15_95)] text-[oklch(0.13_0.005_250)]',    // gold
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export type MemberKind = 'human' | 'independent' | 'personal_assistant';

interface MemberAvatarProps {
  name: string;
  kind?: MemberKind; // defaults to 'human'
  size?: 'sm' | 'md' | 'lg';
  health?: 'ok' | 'warn' | 'down';
  className?: string;
}

const SIZE_MAP = {
  sm: 'size-6 text-[0.625rem]',
  md: 'size-8 text-[0.6875rem]',
  lg: 'size-10 text-xs',
};

const HEALTH_DOT_CLASS: Record<string, string> = {
  ok: 'bg-primary',
  warn: 'bg-[var(--status-asserted)]',
  down: 'bg-[var(--status-falsified)]',
};

export function MemberAvatar({
  name,
  kind = 'human',
  size = 'md',
  health = 'ok',
  className,
}: MemberAvatarProps) {
  const colorIdx = hashString(name) % AVATAR_COLORS.length;
  const colorClass = AVATAR_COLORS[colorIdx];
  const initials = initialsOf(name) || '?';
  const showHealthDot = kind !== 'human' && health !== 'ok';

  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={cn(SIZE_MAP[size], 'font-semibold')}>
        <AvatarFallback
          className={cn(colorClass, 'font-semibold')}
          aria-hidden
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      {showHealthDot ? (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-card size-2.5',
            HEALTH_DOT_CLASS[health],
          )}
          aria-label={`health: ${health}`}
          title={`health: ${health}`}
        />
      ) : null}
      <span className="sr-only">
        {name}
        {kind !== 'human' ? `, ${kind}` : ''}
        {health !== 'ok' ? `, health ${health}` : ''}
      </span>
    </div>
  );
}

// ─── Member badge — small pill rendered next to the name ─────────────────────
// Per the user: agents should be visually distinct from humans via a small badge,
// not a role icon. Personal assistants get a different badge so others can see
// "this is someone's personal assistant" when the PA is @mentioned in a channel.

interface MemberBadgeProps {
  kind: MemberKind;
  ownerName?: string; // for personal assistants — the human they belong to
  className?: string;
}

const BADGE_STYLES: Record<MemberKind, { label: string; className: string }> = {
  human: {
    label: '',
    className: '',
  },
  independent: {
    label: 'agent',
    className:
      'bg-primary/15 text-primary border-primary/20',
  },
  personal_assistant: {
    label: 'personal',
    className:
      'bg-[var(--status-asserted)]/15 text-[var(--status-asserted)] border-[var(--status-asserted)]/20',
  },
};

export function MemberBadge({ kind, ownerName, className }: MemberBadgeProps) {
  if (kind === 'human') return null;
  const { label, className: badgeClass } = BADGE_STYLES[kind];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1 py-0 text-[0.625rem] font-medium leading-none',
        badgeClass,
        className,
      )}
    >
      {label}
      {ownerName ? <span className="ml-0.5 opacity-70">· {ownerName}&apos;s</span> : null}
    </span>
  );
}

// ─── Backward-compat shim ───────────────────────────────────────────────────
// The old AgentAvatar is still imported by a few components. Re-export
// MemberAvatar under the old name with a kind-deriving adapter so existing
// callers keep working until they're migrated.
export function AgentAvatar(props: Omit<MemberAvatarProps, 'kind'> & { kind?: MemberKind }) {
  // Convert legacy "role" prop (used in old callers) — keep the default as 'independent'.
  return <MemberAvatar {...props} kind={props.kind ?? 'independent'} />;
}
