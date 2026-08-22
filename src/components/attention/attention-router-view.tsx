// Vuno — Attention Router view
// Shows what each agent listens for in channel chatter. Per the design
// principle "Powerful": the org isn't passive — agents monitor the conversation
// and auto-wake when content matches their domain of expertise. This view
// surfaces the pattern rules so users can see (and trust) the mechanism.
//
// Per the "Beautiful" principle: warm cream cards, status-colored role icons,
// keyword chips, weight bars. Italic descriptions like a colleague's notebook.

'use client';

import { ATTENTION_PATTERNS } from '@/lib/agents/attention-router';
import { ROLE_LABELS, ROLE_ICONS } from '@/lib/agents/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Radar, Eye, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// Status color per role — warm palette, NO indigo/blue.
// Match the agent's domain to a status color for visual scanning.
const ROLE_TOPIC_COLOR: Record<string, string> = {
  security: 'var(--status-falsified)',       // red-orange — defensive
  perf: 'var(--status-tested)',              // emerald — measured
  verifier: 'var(--status-believed)',        // sky — calm checks
  hr: 'var(--status-asserted)',              // amber — warm org
  architect: 'var(--status-uncertain)',      // gray — neutral design
  devils_advocate: 'var(--status-asserted)', // amber — caution
};

export function AttentionRouterView() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border/40 px-6 py-4">
        <div className="flex items-center gap-2">
          <Radar className="size-4 text-[var(--status-believed)]" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight">Attention Router</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Agents don&apos;t just wait for debates — they monitor channel chatter and auto-wake
          when content matches their domain. Each agent posts a brief, conversational observation
          within ~1s of you sending a relevant message.
        </p>
      </header>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {/* Summary banner — explains the magic moment */}
          <Card className="mb-6 border-l-2 border-[var(--status-believed)]/40 bg-[var(--status-believed)]/[0.04]">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--status-believed)]/15">
                <Eye className="size-3.5 text-[var(--status-believed)]" aria-hidden />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium leading-snug">
                  The magic moment
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Post a message mentioning &quot;security&quot;, &quot;latency&quot;, &quot;test&quot;,
                  &quot;objective&quot;, &quot;architecture&quot;, or &quot;risk&quot; in any channel.
                  Within ~1s, the relevant agent will post a brief observation.
                  Max 2 agents wake per message (highest confidence first) — keeps the
                  channel calm, not bursty.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Pattern Rules
            </h3>
            <span className="text-[0.6875rem] text-muted-foreground">
              {ATTENTION_PATTERNS.length} agents listening
            </span>
          </div>

          <ul className="flex flex-col gap-3">
            {ATTENTION_PATTERNS.map((pattern) => {
              const color = ROLE_TOPIC_COLOR[pattern.role] ?? 'var(--status-uncertain)';
              const roleLabel = ROLE_LABELS[pattern.role] ?? pattern.role;
              const iconGlyph = ROLE_ICONS[pattern.role] ?? 'Radar';
              const weightPct = Math.round(pattern.weight * 100);
              return (
                <li key={pattern.role}>
                  <Card
                    className={cn(
                      'overflow-hidden border-l-2 transition-colors hover:bg-accent/30',
                    )}
                    style={{ borderColor: color }}
                  >
                    <CardHeader className="gap-1.5 pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex size-6 items-center justify-center rounded-md"
                            style={{ backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)` }}
                          >
                            <span className="text-[0.6875rem] font-semibold" style={{ color }}>
                              {iconGlyph.slice(0, 1)}
                            </span>
                          </span>
                          <CardTitle className="text-sm font-semibold tracking-tight">
                            {roleLabel}
                          </CardTitle>
                          <span
                            className="rounded px-1.5 py-0 font-mono text-[0.625rem] uppercase tracking-wider"
                            style={{
                              backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
                              color,
                            }}
                          >
                            {pattern.topic}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                          <Sparkles className="size-3" aria-hidden />
                          <span>weight {weightPct}%</span>
                        </div>
                      </div>
                      <p className="text-xs italic leading-relaxed text-muted-foreground/90">
                        {pattern.description}
                      </p>
                    </CardHeader>
                    <CardContent className="pt-1">
                      <div className="mb-1.5 text-[0.625rem] uppercase tracking-widest text-muted-foreground/70">
                        keywords
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {pattern.keywords.map((kw) => (
                          <span
                            key={kw}
                            className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground/80"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                      {/* Confidence bar */}
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground/70">
                          base confidence
                        </span>
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${weightPct}%`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                        <span className="font-mono text-[0.6875rem] text-muted-foreground">
                          {weightPct}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>

          <footer className="mt-8 rounded-md border border-border/40 bg-muted/20 px-4 py-3">
            <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
              <span className="font-medium">How it works:</span> when you post a message in
              any channel, the events API fires the attention router in the background.
              Each pattern&apos;s keywords are matched (case-insensitive substring). The top 2
              matches by confidence wake their agent — first an{' '}
              <span className="font-mono">AttentionWakeup</span> event appears in chat,
              then the agent posts a brief observation. Threshold: confidence ≥ 30%.
            </p>
          </footer>
        </div>
      </ScrollArea>
    </div>
  );
}
