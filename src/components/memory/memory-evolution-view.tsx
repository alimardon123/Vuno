// Vuno — Memory Evolution view
// Shows how the personal assistant's model of the owner has grown over time.
// Per the design principle "Powerful": the PA visibly learns — every detected
// fact is an auditable event. This view surfaces that evolution so users can
// see (and trust) what the PA has learned about them.
//
// Two panels:
//   1. Current state — the PA's current PersonalMemory (Tier 2) key-value pairs
//   2. Timeline — all MemoryUpdated events in reverse-chronological order,
//      each showing: when learned, the fact, evidence (the message), prior value
//
// Per the "Beautiful" principle: warm cream cards, amber accent (learned),
// fact-type pills, italic evidence hints like a colleague's notebook.

'use client';

import { useMemo } from 'react';
import { useFetch } from '@/hooks/use-fetch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Brain, History, UserCircle, Sparkles, BookOpen } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface PersonalMemoryEntry {
  id: string;
  agentId: string;
  ownerHumanId: string;
  key: string;
  value: string | string[] | unknown;
  category: string;
  createdAt: string;
  updatedAt: string;
}

interface PersonalMemoryResponse {
  memories: PersonalMemoryEntry[];
  count: number;
}

interface MemoryEventPayload {
  agentId: string;
  agentName: string;
  ownerHumanId: string;
  ownerName: string;
  factType: 'interest' | 'focus_area' | 'sentiment' | 'preference';
  key: string;
  value: string;
  oldValue: string | null;
  evidenceEventId: string;
  confidence: number;
}

interface EventsResponse {
  events: Array<{
    id: string;
    seq: number;
    type: string;
    payload: MemoryEventPayload | string;
    createdAt: string;
    actorAgentId?: string;
  }>;
}

// Fact-type → status color (warm palette, NO indigo/blue)
const FACT_TYPE_COLOR: Record<string, string> = {
  interest: 'var(--status-believed)',    // sky — calm curiosity
  focus_area: 'var(--status-tested)',     // emerald — grounded
  sentiment: 'var(--status-asserted)',    // amber — emotional
  preference: 'var(--status-asserted)',  // amber — personal
};

const FACT_TYPE_LABEL: Record<string, string> = {
  interest: 'INTEREST',
  focus_area: 'FOCUS AREA',
  sentiment: 'SENTIMENT',
  preference: 'PREFERENCE',
};

// Render a PersonalMemory value (JSON array or string) as chips
function renderValue(value: unknown): { chips: string[]; raw: string } {
  if (Array.isArray(value)) {
    return { chips: value.filter((x) => typeof x === 'string') as string[], raw: JSON.stringify(value) };
  }
  if (typeof value === 'string') {
    // Try parsing as JSON array
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return { chips: parsed.filter((x) => typeof x === 'string') as string[], raw: value };
      }
      return { chips: [parsed], raw: value };
    } catch {
      return { chips: [value], raw: value };
    }
  }
  return { chips: [String(value)], raw: String(value) };
}

export function MemoryEvolutionView() {
  // Fetch the PA's personal memory (Bob's model of Kai)
  // We need to find Bob first — fetch agents, find the PA, then fetch its memory
  const agentsRes = useFetch<{ agents: Array<{ id: string; name: string; role: string; kind: string; ownerHumanId: string | null }> }>('/api/agents');
  const pa = useMemo(
    () => agentsRes.data?.agents.find((a) => a.kind === 'personal_assistant') ?? null,
    [agentsRes.data],
  );

  const memoryUrl = pa ? `/api/personal-memory?agentId=${pa.id}` : null;
  const memoryRes = useFetch<PersonalMemoryResponse>(memoryUrl);

  // Fetch all MemoryUpdated events across the org (no scope filter — we want all learning)
  const eventsRes = useFetch<EventsResponse>('/api/events?limit=500');

  const memoryEvents = useMemo(() => {
    const all = eventsRes.data?.events ?? [];
    return all
      .filter((e) => e.type === 'MemoryUpdated')
      .map((e) => {
        const payload = typeof e.payload === 'string' ? (JSON.parse(e.payload) as MemoryEventPayload) : e.payload;
        return { ...e, payload };
      })
      .sort((a, b) => b.seq - a.seq);
  }, [eventsRes.data]);

  const memories = memoryRes.data?.memories ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border/40 px-6 py-4">
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-[var(--status-asserted)]" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight">Memory Evolution</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {pa ? (
            <>
              <span className="font-medium">{pa.name}</span> (your personal assistant) silently learns
              from your messages — interests, focus areas, sentiment, stated preferences.
              Every learned fact is auditable here.
            </>
          ) : (
            'Loading your personal assistant…'
          )}
        </p>
      </header>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="mx-auto max-w-5xl px-6 py-6">
          {/* ─── Current state ─────────────────────────────────────────── */}
          <section aria-label="Current state" className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <UserCircle className="size-3.5 text-muted-foreground" aria-hidden />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Current Model
                </h3>
              </div>
              <span className="text-[0.6875rem] text-muted-foreground">
                {memories.length} fact{memories.length === 1 ? '' : 's'} known
              </span>
            </div>

            {memoryRes.loading && !memoryRes.data ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : memories.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex items-center gap-3 p-6 text-center">
                  <Brain className="size-5 text-muted-foreground/50" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      No memories yet
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      Post a message mentioning a tech (Rust, Kubernetes, …), a domain
                      (distributed systems, security, …), or a sentiment (worried, excited, …)
                      and {pa?.name ?? 'your PA'} will learn from it.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {memories.map((m) => {
                  const { chips } = renderValue(m.value);
                  const color = m.category === 'context' ? FACT_TYPE_COLOR.sentiment
                    : m.category === 'preference' ? FACT_TYPE_COLOR.preference
                    : FACT_TYPE_COLOR.interest;
                  return (
                    <Card
                      key={m.id}
                      className="overflow-hidden border-l-2 transition-colors hover:bg-accent/30"
                      style={{ borderColor: color }}
                    >
                      <CardHeader className="gap-1 pb-1">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="font-mono text-xs font-semibold tracking-tight text-foreground/90">
                            {m.key}
                          </CardTitle>
                          <span
                            className="rounded px-1.5 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider"
                            style={{
                              backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
                              color,
                            }}
                          >
                            {m.category}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-1">
                        <div className="flex flex-wrap gap-1">
                          {chips.length === 0 ? (
                            <span className="font-mono text-xs text-muted-foreground/60">(empty)</span>
                          ) : chips.map((c, i) => (
                            <span
                              key={`${c}-${i}`}
                              className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground/80"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-[0.625rem] text-muted-foreground/70">
                          updated {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true })}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* ─── Timeline ──────────────────────────────────────────────── */}
          <section aria-label="Learning timeline">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <History className="size-3.5 text-muted-foreground" aria-hidden />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Learning Timeline
                </h3>
              </div>
              <span className="text-[0.6875rem] text-muted-foreground">
                {memoryEvents.length} learning event{memoryEvents.length === 1 ? '' : 's'}
              </span>
            </div>

            {memoryEvents.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex items-center gap-3 p-6 text-center">
                  <BookOpen className="size-5 text-muted-foreground/50" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      No learning events yet
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      The timeline will fill in as {pa?.name ?? 'your PA'} learns from your messages.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <ol className="relative flex flex-col gap-3 border-l border-border/40 pl-4">
                {memoryEvents.map((e) => {
                  const p = e.payload;
                  const color = FACT_TYPE_COLOR[p.factType] ?? FACT_TYPE_COLOR.interest;
                  const isNew = p.oldValue === null;
                  const confidencePct = Math.round(p.confidence * 100);
                  const factTypeLabel = FACT_TYPE_LABEL[p.factType] ?? p.factType.toUpperCase();
                  return (
                    <li key={e.id} className="relative">
                      {/* Timeline dot */}
                      <span
                        className="absolute -left-[1.4rem] top-2 inline-flex size-2.5 items-center justify-center rounded-full"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      <Card
                        className="overflow-hidden border-l-2 transition-colors hover:bg-accent/30"
                        style={{ borderColor: color }}
                      >
                        <CardContent className="p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className="rounded px-1.5 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider"
                                style={{
                                  backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
                                  color,
                                }}
                              >
                                {factTypeLabel}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {p.key} →
                              </span>
                              <span className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground/80">
                                {p.value}
                              </span>
                              {isNew ? (
                                <span className="text-[0.625rem] font-medium text-[var(--status-tested)]">
                                  new
                                </span>
                              ) : (
                                <span className="text-[0.625rem] text-muted-foreground/70">
                                  was: <span className="font-mono line-through">
                                    {p.oldValue && p.oldValue.length > 40 ? p.oldValue.slice(0, 40) + '…' : p.oldValue}
                                  </span>
                                </span>
                              )}
                            </div>
                            <span
                              className="inline-flex items-center gap-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider"
                              style={{ color }}
                              title={`confidence: ${confidencePct}%`}
                            >
                              <Sparkles className="size-2.5" aria-hidden />
                              {confidencePct}%
                            </span>
                          </div>
                          <p className="mt-1.5 text-[0.6875rem] italic text-muted-foreground/80">
                            {p.agentName} learned this about {p.ownerName} from a message{' '}
                            <span className="font-mono not-italic text-muted-foreground/60">
                              {p.evidenceEventId.slice(0, 12)}…
                            </span>
                          </p>
                          <p className="mt-1 text-[0.625rem] text-muted-foreground/60" title={format(new Date(e.createdAt), 'PPpp')}>
                            {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                          </p>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* ─── How it works ──────────────────────────────────────────── */}
          <footer className="mt-8 rounded-md border border-border/40 bg-muted/20 px-4 py-3">
            <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
              <span className="font-medium">How it works:</span> when you post a message in
              any channel, {pa?.name ?? 'your PA'} runs a memory detector in the background.
              Detected facts (interests, focus areas, sentiment, stated preferences) are
              upserted into PersonalMemory (Tier 2) and a{' '}
              <span className="font-mono">MemoryUpdated</span> event is appended to the spine.
              Already-known facts don&apos;t trigger events (no spam). Caps at 4 facts per
              message. Confidence per fact type: interests 0.8, focus areas 0.75, sentiment
              0.65-0.85, stated preferences 0.75-0.9.
            </p>
          </footer>
        </div>
      </ScrollArea>
    </div>
  );
}
