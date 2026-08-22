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
import {
  Brain,
  ArrowRight,
  ArrowDown,
  Reply,
  Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useMemo } from 'react';

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
  visibility: string;
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
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
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
        </div>
      </ScrollArea>
    </div>
  );
}
