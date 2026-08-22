// AI Org OS — Timeline scrubber for the decision page
// Per ADR-0004 thesis: "replay, audit, time-travel for free".
// Lets the user scrub through the event spine for this decision and see the
// state at any point in time. Each event is a tick; the slider sets a cutoff
// at seq=N. Events with seq > N are hidden (ghosted), demonstrating that the
// current state is a projection of the append-only log.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { EventRecord } from '@/lib/events/types';
import { format } from 'date-fns';
import {
  History,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Clock,
} from 'lucide-react';

interface TimelineScrubberProps {
  events: EventRecord[];
}

// Map event type → short label + status-hint color
const EVENT_META: Record<string, { label: string; color?: string }> = {
  ProposalOpened: { label: 'Proposal', color: 'var(--status-believed)' },
  RoleAssigned: { label: 'Role', color: 'var(--status-uncertain)' },
  ObjectionRaised: { label: 'Objection', color: 'var(--status-asserted)' },
  EvidenceAttached: { label: 'Evidence', color: 'var(--status-believed)' },
  AlternativeProposed: { label: 'Alternative', color: 'var(--status-uncertain)' },
  ExperimentRequested: { label: 'Exp requested', color: 'var(--status-asserted)' },
  ExperimentCompleted: { label: 'Exp completed', color: 'var(--status-tested)' },
  BenchmarkReported: { label: 'Benchmark', color: 'var(--status-tested)' },
  RiskFlagged: { label: 'Risk', color: 'var(--status-falsified)' },
  DecisionRecorded: { label: 'Decision', color: 'var(--status-falsified)' },
  ClaimStatusChanged: { label: 'Claim', color: 'var(--status-falsified)' },
  GateEvaluated: { label: 'Gate eval', color: 'var(--status-uncertain)' },
  GateBlocked: { label: 'Gate blocked', color: 'var(--status-falsified)' },
  GatePassed: { label: 'Gate passed', color: 'var(--status-tested)' },
};

export function TimelineScrubber({ events }: TimelineScrubberProps) {
  const [maxSeq, setMaxSeq] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const sorted = useMemo(
    () => [...events].sort((a, b) => a.seq - b.seq),
    [events],
  );

  const minSeq = sorted[0]?.seq ?? 0;
  const lastSeq = sorted[sorted.length - 1]?.seq ?? 0;
  const currentMax = maxSeq ?? lastSeq;
  const visibleEvents = sorted.filter((e) => e.seq <= currentMax);
  const hiddenEvents = sorted.filter((e) => e.seq > currentMax);

  // State summary at currentMax: count event types, derive "state" of the debate
  const summary = deriveStateSummary(visibleEvents);

  const isAtEnd = currentMax >= lastSeq;
  const isAtStart = currentMax <= minSeq;

  function stepBack() {
    setMaxSeq(Math.max(minSeq, currentMax - 1));
  }
  function stepForward() {
    setMaxSeq(Math.min(lastSeq, currentMax + 1));
  }
  function reset() {
    setMaxSeq(lastSeq);
    setPlaying(false);
  }

  // Auto-play effect — advances the timeline every 1.1s while playing.
  // Must be called unconditionally (before any early return) per rules-of-hooks.
  useAutoPlay({
    playing: playing && sorted.length > 0,
    currentMax,
    lastSeq,
    onTick: () => setMaxSeq((cur) => (cur === null ? lastSeq : Math.min(lastSeq, cur + 1))),
    onDone: () => setPlaying(false),
  });

  if (sorted.length === 0) return null;

  return (
    <Card className="gap-2 py-4">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="size-3.5 opacity-70" aria-hidden />
          Timeline scrubber
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            time-travel the debate · {visibleEvents.length} of {sorted.length} events visible
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            onClick={reset}
            disabled={maxSeq === null}
            aria-label="Reset to latest"
            title="Reset to latest"
          >
            <RotateCcw className="size-3" aria-hidden />
            Latest
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Slider */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={stepBack}
            disabled={isAtStart || playing}
            aria-label="Step back"
            title="Step back one event"
          >
            <SkipBack className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => setPlaying((p) => !p)}
            disabled={isAtEnd}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause auto-advance' : 'Play forward'}
          >
            {playing ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={stepForward}
            disabled={isAtEnd || playing}
            aria-label="Step forward"
            title="Step forward one event"
          >
            <SkipForward className="size-3.5" />
          </Button>
          <div className="flex flex-1 items-center gap-3">
            <Slider
              value={[currentMax]}
              min={minSeq}
              max={lastSeq}
              step={1}
              onValueChange={(v) => {
                const next = v[0];
                if (typeof next === 'number') setMaxSeq(next);
              }}
              disabled={playing}
              aria-label="Event sequence scrubber"
            />
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              #{currentMax}
              <span className="text-muted-foreground/60">/#{lastSeq}</span>
            </span>
          </div>
        </div>

        {/* State summary at currentMax */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryStat
            label="state"
            value={summary.state}
            color={summary.stateColor}
          />
          <SummaryStat
            label="objections"
            value={String(summary.objections)}
            color="var(--status-asserted)"
          />
          <SummaryStat
            label="evidence"
            value={String(summary.evidence)}
            color="var(--status-believed)"
          />
          <SummaryStat
            label="benchmarks"
            value={String(summary.benchmarks)}
            color="var(--status-tested)"
          />
        </div>

        {/* Event tick list — visible events solid, hidden events ghosted */}
        <div className="max-h-48 overflow-y-auto scrollbar-sleek rounded-md border border-border/40 bg-card/20 p-2">
          <ol className="flex flex-col gap-1">
            {sorted.map((e) => {
              const isHidden = e.seq > currentMax;
              const meta = EVENT_META[e.type] ?? { label: e.type };
              const payload = e.payload as { body?: string; title?: string; claimText?: string };
              const summary =
                (typeof payload.title === 'string' && payload.title) ||
                (typeof payload.body === 'string' && payload.body.slice(0, 80)) ||
                (typeof payload.claimText === 'string' && payload.claimText.slice(0, 80)) ||
                '';
              return (
                <li
                  key={e.id}
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1 text-xs transition-opacity',
                    isHidden && 'opacity-30',
                  )}
                >
                  <span className="w-12 shrink-0 text-right font-mono text-muted-foreground/70">
                    #{e.seq}
                  </span>
                  <span
                    className="w-24 shrink-0 truncate font-mono text-[0.6875rem]"
                    style={{ color: meta.color ?? 'var(--status-uncertain)' }}
                  >
                    {meta.label}
                  </span>
                  <span className="flex-1 truncate text-foreground/80" title={summary}>
                    {summary}
                  </span>
                  <time
                    className="shrink-0 text-[0.6875rem] text-muted-foreground/70"
                    title={format(new Date(e.createdAt), 'PPpp')}
                  >
                    {format(new Date(e.createdAt), 'HH:mm:ss')}
                  </time>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Hint */}
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <Clock className="size-3" aria-hidden />
          {maxSeq === null
            ? 'Showing the latest state. Scrub left to time-travel — the substrate is append-only, so every past state is recoverable by replaying up to seq=N.'
            : `Viewing the decision as it was at seq #${currentMax}. ${hiddenEvents.length} events hidden.`}
        </p>
      </CardContent>
    </Card>
  );
}

// Derive a high-level "state" of the debate at a given point in the timeline.
function deriveStateSummary(events: EventRecord[]): {
  state: string;
  stateColor: string;
  objections: number;
  evidence: number;
  benchmarks: number;
} {
  const hasProposal = events.some((e) => e.type === 'ProposalOpened');
  const hasObjection = events.some((e) => e.type === 'ObjectionRaised');
  const hasBenchmark = events.some((e) => e.type === 'BenchmarkReported');
  const hasDecisionRecorded = events.some((e) => e.type === 'DecisionRecorded');
  const hasGateBlocked = events.some((e) => e.type === 'GateBlocked');

  let state = 'draft';
  let stateColor = 'var(--status-uncertain)';
  if (hasProposal && !hasObjection) {
    state = 'believed';
    stateColor = 'var(--status-believed)';
  }
  if (hasObjection) {
    state = 'contested';
    stateColor = 'var(--status-asserted)';
  }
  if (events.some((e) => e.type === 'ExperimentRequested')) {
    state = 'experiment_pending';
    stateColor = 'var(--status-asserted)';
  }
  if (hasDecisionRecorded) {
    state = hasBenchmark ? 'falsified' : 'resolved';
    stateColor = hasBenchmark
      ? 'var(--status-falsified)'
      : 'var(--status-tested)';
  }
  if (hasGateBlocked) {
    state = 'gate_blocked';
    stateColor = 'var(--status-falsified)';
  }

  return {
    state,
    stateColor,
    objections: events.filter((e) => e.type === 'ObjectionRaised').length,
    evidence: events.filter((e) => e.type === 'EvidenceAttached').length,
    benchmarks: events.filter((e) => e.type === 'BenchmarkReported').length,
  };
}

function SummaryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-md border border-border/40 bg-card/30 px-3 py-1.5">
      <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

// Auto-play effect — when `playing` is true, advance currentMax every 1.1s.
// Implemented inside the main component via useEffect so it cleans up properly.
function useAutoPlay(opts: {
  playing: boolean;
  currentMax: number;
  lastSeq: number;
  onTick: () => void;
  onDone: () => void;
}) {
  const { playing, currentMax, lastSeq, onTick, onDone } = opts;
  useEffect(() => {
    if (!playing) return;
    if (currentMax >= lastSeq) {
      onDone();
      return;
    }
    const id = window.setTimeout(() => {
      onTick();
    }, 1100);
    return () => window.clearTimeout(id);
  }, [playing, currentMax, lastSeq, onTick, onDone]);
}
