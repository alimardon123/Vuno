// Vuno — Trace View
// Reconstructs the causal chain from a single user message and renders it as a
// vertical timeline with agent nodes + connecting lines. Per the product vision:
// "traceable, falsifiable reasoning" — this makes the collaboration loop VISIBLE.
//
// Per the "Beautiful" principle: warm cream timeline rail, status-colored nodes
// per relation type, agent avatars, typed badges, italic causal explanations.
// Per the "Simple" principle: one fetch, one timeline, one pass.

'use client';

import { useFetch } from '@/hooks/use-fetch';
import { MemberAvatar } from '@/components/common/agent-avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import {
  User,
  Eye,
  Brain,
  ArrowUpRight,
  MessageSquare,
  GitBranch,
  Sparkles,
  X,
  Activity,
  Clock,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TraceEvent {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown> | string;
  actorType: string;
  actorMemberId?: string;
  onBehalfOfMemberId?: string | null;
  scopeType: string;
  scopeId: string;
  createdAt: string;
}

interface TraceNode {
  event: TraceEvent;
  relation: 'trigger' | 'reaction' | 'learning' | 'proactive' | 'delegation' | 'response';
  causalExplanation: string;
}

interface TraceResponse {
  ok: boolean;
  triggerEvent: TraceEvent | null;
  nodes: TraceNode[];
  stats: {
    totalEvents: number;
    agentsInvolved: string[];
    eventTypes: string[];
    durationMs: number;
  };
}

// Relation → status color (warm palette, NO indigo/blue)
const RELATION_COLOR: Record<TraceNode['relation'], string> = {
  trigger: 'var(--status-tested)',      // emerald — the origin
  reaction: 'var(--status-believed)',    // sky — attention router
  learning: 'var(--status-asserted)',    // amber — PA learned
  proactive: 'var(--status-asserted)',   // amber — PA acted
  delegation: 'var(--status-asserted)',  // amber — PA delegated
  response: 'var(--status-tested)',      // emerald — expert responded
};

const RELATION_ICON: Record<TraceNode['relation'], typeof User> = {
  trigger: User,
  reaction: Eye,
  learning: Brain,
  proactive: Sparkles,
  delegation: ArrowUpRight,
  response: MessageSquare,
};

const RELATION_LABEL: Record<TraceNode['relation'], string> = {
  trigger: 'TRIGGER',
  reaction: 'REACTION',
  learning: 'LEARNED',
  proactive: 'PROACTIVE',
  delegation: 'HANDOFF',
  response: 'RESPONSE',
};

// Extract actor name from the event payload (varies by type)
function actorNameOf(node: TraceNode): string {
  const p = typeof node.event.payload === 'string'
    ? (safeParse(node.event.payload))
    : node.event.payload;
  if (node.event.actorType === 'human') return 'Kai';
  if (node.event.actorType === 'system') return 'system';
  // agent — try payload fields
  if (node.relation === 'delegation') {
    return `${p?.fromAgentName ?? 'Agent'} → ${p?.toAgentName ?? 'expert'}`;
  }
  return (p?.agentName as string) ?? (p?.fromAgentName as string) ?? (p?.toAgentName as string) ?? 'Agent';
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}

// Extract a short body/summary from the event payload for the timeline
function summaryOf(node: TraceNode): string {
  const p = typeof node.event.payload === 'string' ? safeParse(node.event.payload) : node.event.payload;
  if (!p) return '';
  switch (node.event.type) {
    case 'MessagePosted':
      return String(p.body ?? '').slice(0, 120);
    case 'AttentionWakeup':
      return `topic: ${p.topic} · confidence: ${Math.round(Number(p.confidence) * 100)}%`;
    case 'MemoryUpdated':
      return `${p.factType} → ${p.value}${p.oldValue ? ` (was: ${String(p.oldValue).slice(0, 30)})` : ' (new)'}`;
    case 'PaProactiveNote':
      return String(p.body ?? '').slice(0, 120);
    case 'AgentHandoff':
      return String(p.request ?? '').slice(0, 100);
    default:
      return '';
  }
}

export function TraceView({ triggerEventId, onClose }: { triggerEventId: string | null; onClose?: () => void }) {
  const url = triggerEventId ? `/api/trace?triggerEventId=${triggerEventId}` : null;
  const { data, loading } = useFetch<TraceResponse>(url);

  if (!triggerEventId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Select a message to view its trace.
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!data || !data.ok) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Failed to load trace.
      </div>
    );
  }

  const { nodes, stats } = data;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-[var(--status-asserted)]" aria-hidden />
            <h2 className="text-sm font-semibold tracking-tight">Causal Trace</h2>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close trace"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* Stats row */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.6875rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Activity className="size-3" aria-hidden />
            {stats.totalEvents} event{stats.totalEvents === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" aria-hidden />
            {stats.agentsInvolved.length} agent{stats.agentsInvolved.length === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            {(stats.durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </header>

      {/* Timeline */}
      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="px-4 py-4">
          {nodes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No causal chain found for this message.
            </p>
          ) : (
            <ol className="relative flex flex-col gap-0">
              {/* Vertical rail */}
              <div className="absolute bottom-4 left-[1.4rem] top-4 w-px bg-border/50" aria-hidden />

              {nodes.map((node, idx) => {
                const color = RELATION_COLOR[node.relation];
                const Icon = RELATION_ICON[node.relation];
                const label = RELATION_LABEL[node.relation];
                const name = actorNameOf(node);
                const summary = summaryOf(node);
                const isLast = idx === nodes.length - 1;
                const actorKind = node.event.actorType === 'human' ? 'human' : node.event.actorType === 'system' ? 'human' : 'independent';

                return (
                  <li key={node.event.id} className="relative flex gap-3 pb-4">
                    {/* Node dot + icon */}
                    <div className="relative z-10 flex shrink-0 flex-col items-center">
                      <span
                        className="inline-flex size-7 items-center justify-center rounded-full border-2 bg-card"
                        style={{ borderColor: color, backgroundColor: `color-mix(in oklch, ${color} 10%, var(--card))` }}
                      >
                        <Icon className="size-3" style={{ color }} aria-hidden />
                      </span>
                      {/* Connecting line segment to next node */}
                      {!isLast ? (
                        <span className="mt-1 h-full w-px flex-1 bg-border/30" aria-hidden />
                      ) : null}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider"
                          style={{ backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`, color }}
                        >
                          {label}
                        </span>
                        {node.event.actorType !== 'system' ? (
                          <MemberAvatar name={name} kind={actorKind as 'human' | 'independent'} size="sm" />
                        ) : null}
                        <span className="text-xs font-medium text-foreground/90">{name}</span>
                        <span className="text-[0.625rem] text-muted-foreground/70">
                          · {node.event.type}
                        </span>
                      </div>

                      {summary ? (
                        <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                          {summary}
                        </p>
                      ) : null}

                      <p className="mt-0.5 text-[0.6875rem] italic leading-relaxed text-muted-foreground/80">
                        {node.causalExplanation}
                      </p>

                      <p className="mt-0.5 text-[0.5625rem] text-muted-foreground/50">
                        seq={node.event.seq} · {formatDistanceToNow(new Date(node.event.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {/* Footer — event types */}
          {stats.eventTypes.length > 0 ? (
            <footer className="mt-4 border-t border-border/30 pt-3">
              <div className="mb-1 text-[0.5625rem] uppercase tracking-widest text-muted-foreground/60">
                event types
              </div>
              <div className="flex flex-wrap gap-1">
                {stats.eventTypes.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </footer>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
