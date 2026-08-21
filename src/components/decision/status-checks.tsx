// AI Org OS — Status checks (the gate panel)
// Per SCREENS.md §3: ✓ passed / ✗ blocked / ○ pending, using gate-state colors.

'use client';

import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/common/status-pill';
import type { GateState } from '@/lib/events/types';
import { Check, X, Circle, ShieldCheck } from 'lucide-react';

interface Gate {
  id: string;
  name: string;
  policy: string;
  state: string;
  reason: string | null;
}

interface StatusChecksProps {
  gates: Gate[];
}

function asGateState(s: string): GateState {
  if (s === 'passed' || s === 'blocked' || s === 'pending') return s;
  return 'pending';
}

export function StatusChecks({ gates }: StatusChecksProps) {
  // Group: project gates (release) first, then decision gates (security, qa, perf)
  const sorted = [...gates].sort((a, b) => {
    // 'release' goes last (it's the cascading gate)
    if (a.name === 'release') return 1;
    if (b.name === 'release') return -1;
    return a.name.localeCompare(b.name);
  });

  // Top-level release gate is special — it's the cascading block.
  const releaseGate = sorted.find((g) => g.name === 'release');
  const others = sorted.filter((g) => g.name !== 'release');

  return (
    <section aria-label="Status checks" className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden />
        Status checks (gates)
      </div>

      <ul className="flex flex-col gap-1.5">
        {others.map((g) => {
          const s = asGateState(g.state);
          return (
            <li
              key={g.id}
              className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <GateGlyph state={s} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{g.name}</span>
                  <StatusPill
                    status={s}
                    pulse={s === 'blocked'}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  policy: <span className="font-mono">{g.policy}</span>
                </div>
                {g.reason ? (
                  <div className="text-xs text-muted-foreground">
                    {g.reason}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {releaseGate ? (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border-2 px-3 py-2.5 text-sm',
            asGateState(releaseGate.state) === 'blocked'
              ? 'border-[var(--status-falsified)]/40 bg-[var(--status-falsified)]/[0.06]'
              : 'border-[var(--status-tested)]/40 bg-[var(--status-tested)]/[0.06]',
          )}
        >
          <GateGlyph state={asGateState(releaseGate.state)} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Release gate</span>
              <StatusPill
                status={asGateState(releaseGate.state)}
                pulse={asGateState(releaseGate.state) === 'blocked'}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              policy: <span className="font-mono">{releaseGate.policy}</span>
            </div>
            {releaseGate.reason ? (
              <div className="text-xs text-foreground">{releaseGate.reason}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function GateGlyph({ state }: { state: GateState }) {
  if (state === 'passed')
    return (
      <Check
        className="mt-0.5 size-4 shrink-0 text-[var(--status-tested)]"
        aria-label="passed"
      />
    );
  if (state === 'blocked')
    return (
      <X
        className="mt-0.5 size-4 shrink-0 text-[var(--status-falsified)]"
        aria-label="blocked"
      />
    );
  return (
    <Circle
      className="mt-0.5 size-4 shrink-0 text-[var(--status-asserted)]"
      aria-label="pending"
    />
  );
}
