// Vuno — Status pill
// Small, monochrome background with the status color at 12% opacity, text in the status color.
// No border. Per DESIGN_SYSTEM.md §5.

import { cn } from '@/lib/utils';
import type { ClaimStatus } from '@/lib/events/types';
import type { GateState } from '@/lib/events/types';

export type PillStatus =
  | ClaimStatus
  | GateState
  | 'passed'
  | 'blocked';

// Map each status to its CSS variable.
function statusVar(status: PillStatus): string {
  switch (status) {
    case 'asserted':
    case 'pending':
      return 'var(--status-asserted)';
    case 'believed':
      return 'var(--status-believed)';
    case 'tested':
    case 'passed':
      return 'var(--status-tested)';
    case 'falsified':
    case 'blocked':
      return 'var(--status-falsified)';
    case 'uncertain':
      return 'var(--status-uncertain)';
    default:
      return 'var(--status-uncertain)';
  }
}

// Human label per status — colors are never alone; always paired with text.
function statusLabel(status: PillStatus): string {
  switch (status) {
    case 'asserted':
      return 'asserted';
    case 'believed':
      return 'believed';
    case 'tested':
      return 'tested';
    case 'falsified':
      return 'falsified';
    case 'uncertain':
      return 'uncertain';
    case 'passed':
      return 'passed';
    case 'blocked':
      return 'blocked';
    case 'pending':
      return 'pending';
    default:
      return String(status);
  }
}

// Status glyph per design — small unicode marker paired with the label.
function statusGlyph(status: PillStatus): string {
  switch (status) {
    case 'tested':
    case 'passed':
      return '✓';
    case 'falsified':
    case 'blocked':
      return '✗';
    case 'uncertain':
      return '⚠';
    case 'believed':
      return '◇';
    case 'asserted':
    case 'pending':
      return '○';
    default:
      return '•';
  }
}

interface StatusPillProps {
  status: PillStatus;
  /** Use the glyph marker (defaults to true) */
  withGlyph?: boolean;
  /** Override the label text (still uses the status color) */
  label?: string;
  className?: string;
  /** Apply the status-pulse animation (for blocked-gate alerts) */
  pulse?: boolean;
}

export function StatusPill({
  status,
  withGlyph = true,
  label,
  className,
  pulse = false,
}: StatusPillProps) {
  const color = statusVar(status);
  const text = label ?? statusLabel(status);
  const glyph = withGlyph ? statusGlyph(status) : null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none tracking-wide',
        pulse && 'animate-status-pulse',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
        color,
      }}
      aria-label={text}
      title={text}
    >
      {glyph ? (
        <span aria-hidden className="text-[0.7rem] leading-none">{glyph}</span>
      ) : null}
      <span className="uppercase tracking-wider">{text}</span>
    </span>
  );
}
