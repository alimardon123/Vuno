// AI Org OS — Agent avatar
// Per DESIGN_SYSTEM.md §5: avatar with lucide icon by role + health dot.

'use client';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Cpu,
  Code2,
  ShieldCheck,
  Gauge,
  Bug,
  Scale,
  CheckCheck,
  Compass,
  Microscope,
  Users,
  Crown,
  Bot,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Cpu,
  Code2,
  ShieldCheck,
  Gauge,
  Bug,
  Scale,
  CheckCheck,
  Compass,
  Microscope,
  Users,
  Crown,
};

interface AgentAvatarProps {
  name: string;
  role?: string;
  iconGlyph?: string | null;
  size?: 'sm' | 'md' | 'lg';
  health?: 'ok' | 'warn' | 'down';
  className?: string;
}

const SIZE_MAP = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-10',
};

const HEALTH_DOT_CLASS: Record<string, string> = {
  ok: 'bg-primary',
  warn: 'bg-[var(--status-asserted)]',
  down: 'bg-[var(--status-falsified)]',
};

// Role-colored ring (subtle 1px outer ring) — per VLM QA suggestion #7.
// Aids scanning the member list. Uses status colors that are aligned with role semantics.
const ROLE_RING_CLASS: Record<string, string> = {
  architect: 'ring-[var(--status-believed)]/40',
  engineer: 'ring-[var(--status-believed)]/40',
  security: 'ring-[var(--status-falsified)]/40',
  perf: 'ring-[var(--status-believed)]/40',
  qa: 'ring-[var(--status-asserted)]/40',
  devils_advocate: 'ring-[var(--status-asserted)]/40',
  verifier: 'ring-[var(--status-tested)]/40',
  product: 'ring-[var(--status-believed)]/40',
  research: 'ring-[var(--status-believed)]/40',
  hr: 'ring-[var(--status-uncertain)]/40',
  ceo: 'ring-primary/50',
};

export function AgentAvatar({
  name,
  role,
  iconGlyph,
  size = 'md',
  health = 'ok',
  className,
}: AgentAvatarProps) {
  const Icon = (iconGlyph && ICONS[iconGlyph]) || (role && ICONS[role]) || Bot;
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={cn(SIZE_MAP[size], role && ROLE_RING_CLASS[role], 'ring-1 ring-offset-0')}>
        <AvatarFallback
          className="bg-muted text-muted-foreground"
          aria-hidden
        >
          <Icon className="size-1/2" />
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          'absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-card size-2.5',
          HEALTH_DOT_CLASS[health],
        )}
        aria-label={`health: ${health}`}
        title={`health: ${health}`}
      />
      <span className="sr-only">
        {name}
        {role ? `, role ${role}` : ''}
        {health !== 'ok' ? `, health ${health}` : ''}
      </span>
    </div>
  );
}
