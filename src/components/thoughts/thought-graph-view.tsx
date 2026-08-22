// Vuno — Thought Graph view
// Per the VLM's recommendation: "render the argument graph as a secondary
// visualization." Shows AgentThought events as nodes with thought-to-thought
// edges (relatedThoughtId) as a visual graph.
//
// Layout: vertical timeline grouped by debate (decision). Each thought is a
// node with:
//   - Author name + avatar
//   - Thought type pill (color-coded)
//   - Content
//   - Forward edge: "↳ replying to: X" (if relatedThoughtId)
//   - Reverse edge: "N replies" badge (if replyCount > 0)
//
// This makes the cognitive web visible — agents can see how their reasoning
// connects to other agents' reasoning.

'use client';

import { useFetch } from '@/hooks/use-fetch';
import { useAppStore } from '@/store/app-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MemberAvatar } from '@/components/common/agent-avatar';
import { cn } from '@/lib/utils';
import {
  Brain,
  ArrowRight,
  ArrowDown,
  Reply,
  Sparkles,
  Database,
  Key,
  Lock,
  Users,
  Network,
  List,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useMemo, useState } from 'react';

interface Thought {
  id: string;
  seq: number;
  agentId: string;
  agentName: string;
  agentRole: string;
  agentRoleLabel: string;
  thoughtType: 'observation' | 'hypothesis' | 'conclusion' | 'question' | 'doubt';
  content: string;
  topic: string;
  relatedEventId: string | null;
  relatedThoughtId: string | null;
  replyCount: number;
  visibility: string; // 'agent' | 'team' | 'org'
  createdAt: string;
}

interface ThoughtsResponse {
  thoughts: Thought[];
  count: number;
}

const THOUGHT_COLORS: Record<string, string> = {
  observation: 'var(--status-believed)',
  hypothesis: 'var(--status-believed)',
  conclusion: 'var(--status-tested)',
  question: 'var(--status-uncertain)',
  doubt: 'var(--status-asserted)',
};

export function ThoughtGraphView() {
  const { activeChannelId } = useAppStore();
  const scopeId = activeChannelId ?? 'ch-storage';

  const res = useFetch<ThoughtsResponse>(
    `/api/thoughts?scopeType=channel&scopeId=${scopeId}`,
    { intervalMs: 30000 },
  );

  const thoughts = res.data?.thoughts ?? [];
  const [viewMode, setViewMode] = useState<'timeline' | 'topology'>('timeline');

  // Group thoughts by topic (each topic = one debate/reasoning chain)
  const grouped = useMemo(() => {
    const groups = new Map<string, Thought[]>();
    for (const t of thoughts) {
      const key = t.topic || 'general';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [thoughts]);

  // Build a lookup map for quick thought-by-id resolution
  const thoughtById = useMemo(() => {
    const map = new Map<string, Thought>();
    for (const t of thoughts) map.set(t.id, t);
    return map;
  }, [thoughts]);

  if (res.loading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (thoughts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Brain className="size-8 text-muted-foreground/40" aria-hidden />
        <span className="text-base font-medium">No thoughts yet</span>
        <p className="text-sm text-muted-foreground">
          When agents debate, their reasoning (observations, hypotheses,
          conclusions, doubts) will appear here as a navigable graph.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-border/70 px-6 py-4">
        <div className="flex items-center gap-3">
          <Brain className="size-5 text-primary" aria-hidden />
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Thought Graph</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The cognitive web — how agents&apos; reasoning connects.
              {thoughts.length} thoughts, {thoughts.filter((t) => t.relatedThoughtId).length} edges.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            <Sparkles className="size-3" aria-hidden />
            Generated from the event spine
          </span>
          {/* View toggle: Timeline vs Topology */}
          <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors',
                viewMode === 'timeline' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="size-3" aria-hidden />
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setViewMode('topology')}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors',
                viewMode === 'topology' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Network className="size-3" aria-hidden />
              Topology
            </button>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
          {/* Memory architecture — always shown regardless of view mode */}
          <AgentPrivateMemorySection />
          <PersonalMemorySection />

          {viewMode === 'topology' ? (
            <TopologyView thoughts={thoughts} thoughtById={thoughtById} />
          ) : (
            <>
          {/* Team Memory (Tier 3) — thoughts with visibility='team' */}
          {thoughts.some((t) => (t as { visibility?: string }).visibility === 'team') ? (
            <Card className="border-l-2 border-l-[var(--status-believed)]/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Users className="size-4 text-[var(--status-believed)]" aria-hidden />
                  Team Memory
                  <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
                    {thoughts.filter((t) => (t as { visibility?: string }).visibility === 'team').length} items
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Team conventions and local decisions — visible to team members only (Tier 3).
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {thoughts
                  .filter((t) => (t as { visibility?: string }).visibility === 'team')
                  .map((t) => {
                    const color = THOUGHT_COLORS[t.thoughtType] ?? 'var(--muted-foreground)';
                    return (
                      <div
                        key={t.id}
                        className="flex items-start gap-2 rounded-md border-l-2 bg-muted/10 px-3 py-2"
                        style={{ borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}
                      >
                        <MemberAvatar name={t.agentName} kind="independent" size="sm" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{t.agentName}</span>
                            <span className="rounded bg-[var(--status-believed)]/14 px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider text-[var(--status-believed)]">
                              {t.thoughtType}
                            </span>
                            <span className="rounded bg-muted px-1 py-0 text-[0.5625rem] text-muted-foreground">team</span>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">{t.content}</p>
                        </div>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          ) : null}

          {/* Thought groups (org-visible thoughts) */}
          {grouped.map(([topic, topicThoughts]) => (
            <Card key={topic} className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="capitalize">{topic.replace(/-/g, ' ')}</span>
                  <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
                    {topicThoughts.length} thoughts
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {topicThoughts.map((t, i) => {
                  const color = THOUGHT_COLORS[t.thoughtType] ?? 'var(--muted-foreground)';
                  const parent = t.relatedThoughtId ? thoughtById.get(t.relatedThoughtId) : null;
                  const hasReplies = t.replyCount > 0;
                  const isLast = i === topicThoughts.length - 1;

                  return (
                    <div key={t.id}>
                      {/* Forward edge indicator (if this thought references another) */}
                      {t.relatedThoughtId && parent ? (
                        <div className="ml-6 flex items-center gap-1 py-0.5 text-[0.625rem] text-muted-foreground/60">
                          <ArrowRight className="size-3" aria-hidden />
                          <span>replying to {parent.agentName}&apos;s {parent.thoughtType}</span>
                        </div>
                      ) : null}

                      {/* The thought node */}
                      <div
                        className="flex items-start gap-2 rounded-md border-l-2 bg-muted/10 px-3 py-2 transition-colors hover:bg-muted/20"
                        style={{ borderColor: `color-mix(in oklch, ${color} 40%, transparent)` }}
                      >
                        <MemberAvatar name={t.agentName} kind="independent" size="sm" />

                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{t.agentName}</span>
                            <span
                              className="rounded px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider"
                              style={{
                                backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
                                color,
                              }}
                            >
                              {t.thoughtType}
                            </span>
                            {/* Reverse edge badge — "N replies" */}
                            {hasReplies ? (
                              <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-0 text-[0.5625rem] font-medium text-primary">
                                <Reply className="size-2.5" aria-hidden />
                                {t.replyCount}
                              </span>
                            ) : null}
                            <span className="ml-auto text-[0.625rem] text-muted-foreground/70">
                              {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {t.content}
                          </p>
                        </div>
                      </div>

                      {/* Connector line to next thought (if not last) */}
                      {!isLast ? (
                        <div className="ml-4 h-2 w-px bg-border/40" aria-hidden />
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Personal Assistant Memory section (Tier 2) ───────────────────────────────
interface PersonalMemory {
  id: string;
  agentId: string;
  ownerHumanId: string;
  key: string;
  value: string | Record<string, unknown>;
  category: string;
  updatedAt: string;
}

function PersonalMemorySection() {
  // Fetch personal memories for Bob (the seeded personal assistant)
  const res = useFetch<{ memories: PersonalMemory[]; count: number }>(
    '/api/personal-memory?agentId=agent-bob',
    { intervalMs: 30000 },
  );

  const memories = res.data?.memories ?? [];

  // Group by category (before early return to satisfy rules-of-hooks)
  const grouped = useMemo(() => {
    const groups = new Map<string, PersonalMemory[]>();
    for (const m of memories) {
      const key = m.category || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries());
  }, [memories]);

  if (memories.length === 0) return null;

  return (
    <Card className="border-l-2 border-l-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-primary" aria-hidden />
          Personal Assistant Memory
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
            {memories.length} memories
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Bob&apos;s accumulated knowledge about Kai — preferences, context, history.
          Visible to owner only (Tier 2 of the 4-tier memory architecture).
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {grouped.map(([category, items]) => (
          <div key={category}>
            <div className="mb-1 text-[0.5625rem] uppercase tracking-widest text-muted-foreground/70">
              {category}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {items.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start gap-2 rounded-md border border-border/40 bg-card/30 px-3 py-2 transition-colors hover:bg-card/60"
                >
                  <Key className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-xs font-medium text-foreground/90">{m.key}</span>
                    <span className="text-xs text-muted-foreground">
                      {typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value)}
                    </span>
                    <span className="text-[0.5625rem] text-muted-foreground/60">
                      updated {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Agent Private Memory section (Tier 1) ────────────────────────────────────
interface AgentMemoryItem {
  id: string;
  agentId: string;
  key: string;
  value: string | Record<string, unknown>;
  category: string;
  updatedAt: string;
}

function AgentPrivateMemorySection() {
  // Fetch private memories for Aris (the architect — as a demo)
  const res = useFetch<{ memories: AgentMemoryItem[]; count: number }>(
    '/api/agent-memory?agentId=agent-aris',
    { intervalMs: 30000 },
  );

  const memories = res.data?.memories ?? [];

  const grouped = useMemo(() => {
    const groups = new Map<string, AgentMemoryItem[]>();
    for (const m of memories) {
      const key = m.category || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries());
  }, [memories]);

  if (memories.length === 0) return null;

  return (
    <Card className="border-l-2 border-l-muted-foreground/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          Agent Private Memory
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
            {memories.length} items
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Aris&apos;s private scratchpad — working notes, hypotheses in progress, TODO lists.
          Visible to that agent only (Tier 1 of the 4-tier memory architecture).
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {grouped.map(([category, items]) => (
          <div key={category}>
            <div className="mb-1 text-[0.5625rem] uppercase tracking-widest text-muted-foreground/70">
              {category}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {items.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2"
                >
                  <Key className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-xs font-medium text-foreground/90">{m.key}</span>
                    <span className="text-xs text-muted-foreground">
                      {typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value)}
                    </span>
                    <span className="text-[0.5625rem] text-muted-foreground/60">
                      updated {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Topology View — SVG-based node-link diagram ──────────────────────────────
function TopologyView({
  thoughts,
  thoughtById,
}: {
  thoughts: Thought[];
  thoughtById: Map<string, Thought>;
}) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const orgThoughts = thoughts.filter((t) => t.visibility !== 'team' && t.visibility !== 'agent');
  const edges = orgThoughts
    .filter((t) => t.relatedThoughtId && thoughtById.has(t.relatedThoughtId))
    .map((t) => ({ from: t.relatedThoughtId!, to: t.id }));
  const nodeSpacing = 80;
  const nodeRadius = 24;
  const svgWidth = 600;
  const svgHeight = Math.max(orgThoughts.length * nodeSpacing + 40, 200);
  const positions = new Map<string, { x: number; y: number }>();
  orgThoughts.forEach((t, i) => {
    const hasOutgoing = !!t.relatedThoughtId;
    const hasIncoming = t.replyCount > 0;
    const xOffset = hasOutgoing && hasIncoming ? 350 : hasOutgoing ? 400 : 200;
    positions.set(t.id, { x: xOffset + (i % 3) * 20, y: 40 + i * nodeSpacing });
  });
  // Highlight edges connected to the hovered/selected node
  const activeNode = hoveredNode ?? selectedNode;
  const isEdgeActive = (edge: { from: string; to: string }) =>
    activeNode && (edge.from === activeNode || edge.to === activeNode);
  const isNodeActive = (id: string) =>
    activeNode && (
      id === activeNode ||
      edges.some((e) => (e.from === activeNode && e.to === id) || (e.to === activeNode && e.from === id))
    );
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Network className="size-4 text-primary" aria-hidden />
          Thought Topology
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
            {orgThoughts.length} nodes · {edges.length} edges
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Structural view — hover or click a node to highlight connected edges.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto scrollbar-sleek">
        <svg width={svgWidth} height={svgHeight} className="min-w-full" role="img" aria-label="Thought topology graph">
          {edges.map((edge, i) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const midY = (from.y + to.y) / 2;
            const midX = (from.x + to.x) / 2 - 30;
            const active = isEdgeActive(edge);
            return (
              <path key={`edge-${i}`} d={`M ${from.x} ${from.y + nodeRadius} Q ${midX} ${midY} ${to.x} ${to.y - nodeRadius}`}
                fill="none"
                stroke={active ? 'var(--primary)' : 'oklch(0.50 0.01 60 / 40%)'}
                strokeWidth={active ? 2.5 : 1.5}
                strokeDasharray={active ? '0' : '4 3'}
                style={{ transition: 'all 0.2s ease' }}
              />
            );
          })}
          {orgThoughts.map((t) => {
            const pos = positions.get(t.id);
            if (!pos) return null;
            const color = THOUGHT_COLORS[t.thoughtType] ?? 'var(--muted-foreground)';
            const initials = t.agentName.substring(0, 2).toUpperCase();
            const active = isNodeActive(t.id);
            const dimmed = activeNode && !active;
            return (
              <g
                key={t.id}
                style={{ cursor: 'pointer', opacity: dimmed ? 0.35 : 1, transition: 'opacity 0.2s ease' }}
                onMouseEnter={() => setHoveredNode(t.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => setSelectedNode(selectedNode === t.id ? null : t.id)}
              >
                {t.replyCount > 0 ? (
                  <>
                    <circle cx={pos.x + nodeRadius - 4} cy={pos.y - nodeRadius + 4} r={8} fill="var(--primary)" stroke="var(--background)" strokeWidth={1.5} />
                    <text x={pos.x + nodeRadius - 4} y={pos.y - nodeRadius + 8} textAnchor="middle" fontSize={9} fill="var(--primary-foreground)" fontWeight="bold">{t.replyCount}</text>
                  </>
                ) : null}
                <circle cx={pos.x} cy={pos.y} r={nodeRadius + (active ? 2 : 0)}
                  fill={`color-mix(in oklch, ${color} ${active ? 30 : 20}%, var(--card))`}
                  stroke={color} strokeWidth={active ? 3 : 2}
                  style={{ transition: 'all 0.2s ease' }}
                />
                <text x={pos.x} y={pos.y + 2} textAnchor="middle" fontSize={10} fontWeight="bold" fill={color}>{initials}</text>
                <text x={pos.x} y={pos.y + nodeRadius + 14} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">{t.thoughtType}</text>
                <text x={pos.x + nodeRadius + 10} y={pos.y - 4} fontSize={11} fill="var(--foreground)">
                  {t.content.length > 50 ? t.content.substring(0, 50) + '\u2026' : t.content}
                </text>
                <text x={pos.x + nodeRadius + 10} y={pos.y + 10} fontSize={9} fill="var(--muted-foreground)">{t.agentName}</text>
                {/* Hover tooltip */}
                {hoveredNode === t.id ? (
                  <g>
                    <rect x={pos.x + nodeRadius + 8} y={pos.y + 14} width={Math.min(t.content.length * 4 + 16, 280)} height={36} rx={4}
                      fill="var(--popover)" stroke="var(--border)" strokeWidth={1} />
                    <text x={pos.x + nodeRadius + 14} y={pos.y + 28} fontSize={10} fill="var(--foreground)">
                      {t.content.length > 60 ? t.content.substring(0, 60) + '\u2026' : t.content}
                    </text>
                    <text x={pos.x + nodeRadius + 14} y={pos.y + 42} fontSize={8} fill="var(--muted-foreground)">
                      {t.agentName} · {t.thoughtType} · {t.replyCount} replies
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {Object.entries(THOUGHT_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="size-3 rounded-full border-2" style={{ backgroundColor: `color-mix(in oklch, ${color} 20%, transparent)`, borderColor: color }} />
              {type}
            </span>
          ))}
          <span className="flex items-center gap-1"><span className="size-3 rounded-full bg-primary" />N replies</span>
        </div>
      </CardContent>
    </Card>
  );
}
