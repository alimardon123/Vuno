// AI Org OS — Message bubble
// Renders a single chat message projection. Typed events get a left-border accent
// in their statusHint color + an uppercase typeLabel.

'use client';

import { cn } from '@/lib/utils';
import { AgentAvatar } from '@/components/common/agent-avatar';
import { ROLE_LABELS } from '@/lib/agents/types';
import type { ChatMessageProjection } from '@/lib/events/project';
import type { ClaimStatus, EventPayloadMap } from '@/lib/events/types';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowUpRight,
  ChevronRight,
} from 'lucide-react';
import { useFetch } from '@/hooks/use-fetch';
import { useMemo } from 'react';

interface Agent {
  id: string;
  name: string;
  role: string;
  kind: string;
  teamId: string | null;
  status: string;
  avatarGlyph?: string | null;
}

interface AgentsResponse {
  agents: Agent[];
}

interface MessageBubbleProps {
  message: ChatMessageProjection;
  onOpenDecision?: (decisionId: string) => void;
}

// Map a statusHint to its CSS variable.
function hintColor(hint?: ChatMessageProjection['statusHint']): string | null {
  if (!hint) return null;
  switch (hint) {
    case 'asserted':
      return 'var(--status-asserted)';
    case 'believed':
      return 'var(--status-believed)';
    case 'tested':
      return 'var(--status-tested)';
    case 'falsified':
      return 'var(--status-falsified)';
    case 'uncertain':
      return 'var(--status-uncertain)';
    case 'blocked':
      return 'var(--status-falsified)';
    case 'passed':
      return 'var(--status-tested)';
    default:
      return null;
  }
}

export function MessageBubble({
  message,
  onOpenDecision,
}: MessageBubbleProps) {
  const agentsRes = useFetch<AgentsResponse>('/api/agents');
  const agents = useMemo(
    () => agentsRes.data?.agents ?? [],
    [agentsRes.data?.agents],
  );

  const actorName = useMemo(() => {
    if (message.actorType === 'system') return 'system';
    if (message.actorType === 'human') return 'Kai';
    const a = agents.find((x) => x.id === message.actorAgentId);
    return a?.name ?? 'Agent';
  }, [agents, message.actorAgentId, message.actorType]);

  const actorRole = useMemo(() => {
    if (message.actorType === 'system') return 'system';
    if (message.actorType === 'human') return 'Org Owner';
    const a = agents.find((x) => x.id === message.actorAgentId);
    return a?.role ?? '';
  }, [agents, message.actorAgentId, message.actorType]);

  const isTyped = Boolean(message.typeLabel && message.type !== 'MessagePosted');
  const accent = hintColor(message.statusHint);
  const isSystem = message.actorType === 'system';

  // Extract decision id from payload if available, for the "Open decision" link.
  const decisionId = useMemo(() => {
    const p = message.payload as { decisionId?: string };
    return p?.decisionId ?? null;
  }, [message.payload]);

  const time = formatDistanceToNow(new Date(message.createdAt), {
    addSuffix: true,
  });
  const timeTitle = format(new Date(message.createdAt), 'PPpp');

  return (
    <article
      className={cn(
        'group flex gap-3 px-3 py-2 transition-colors hover:bg-accent/30',
        isSystem && 'bg-muted/30',
      )}
      aria-label={`Message from ${actorName} at ${time}`}
    >
      <div className="mt-0.5">
        <AgentAvatar
          name={actorName}
          role={actorRole}
          size="md"
          health={isSystem ? 'warn' : 'ok'}
        />
      </div>

      <div
        className="flex min-w-0 flex-1 flex-col gap-1"
        style={accent ? { borderLeft: `2px solid ${accent}`, paddingLeft: '0.625rem' } : undefined}
      >
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold leading-none">
            {actorName}
          </span>
          {actorRole && !isSystem ? (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground">
              {ROLE_LABELS[actorRole] ?? actorRole}
            </span>
          ) : null}
          {isTyped && message.typeLabel ? (
            <span
              className="rounded-sm px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-widest"
              style={
                accent
                  ? {
                      backgroundColor: `color-mix(in oklch, ${accent} 14%, transparent)`,
                      color: accent,
                    }
                  : undefined
              }
            >
              {message.typeLabel}
            </span>
          ) : null}
          <time
            className="text-[0.6875rem] text-muted-foreground"
            title={timeTitle}
            dateTime={message.createdAt}
          >
            {time}
          </time>
        </header>

        <MessageBody
          message={message}
          onOpenDecision={onOpenDecision}
          decisionId={decisionId}
        />
      </div>
    </article>
  );
}

// ─── Message body — typed renderer per event payload ────────────────────────
function MessageBody({
  message,
  onOpenDecision,
  decisionId,
}: {
  message: ChatMessageProjection;
  onOpenDecision?: (id: string) => void;
  decisionId: string | null;
}) {
  const p = message.payload as
    | (EventPayloadMap[keyof EventPayloadMap] & { body?: string })
    | null;

  switch (message.type) {
    case 'MessagePosted':
      return <p className="text-sm leading-snug text-foreground">{p?.body}</p>;

    case 'ThreadReplyPosted':
      return (
        <p className="text-sm leading-snug text-foreground">{p?.body}</p>
      );

    case 'ObjectiveFiled': {
      const o = p as EventPayloadMap['ObjectiveFiled'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div className="font-medium">{o.title}</div>
          <div className="text-muted-foreground">
            <span className="text-[0.6875rem] uppercase tracking-wider">
              success criteria:
            </span>{' '}
            {o.successCriteria}
          </div>
          {o.constraints ? (
            <div className="text-muted-foreground">
              <span className="text-[0.6875rem] uppercase tracking-wider">
                constraints:
              </span>{' '}
              {o.constraints}
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-2 text-[0.6875rem] text-muted-foreground">
            {o.budget ? <span>budget: {o.budget}</span> : null}
            <span>autonomy: {o.autonomyLevel}</span>
            {o.owningDepartment ? (
              <span>routed: {o.owningDepartment}</span>
            ) : null}
          </div>
        </div>
      );
    }

    case 'ProposalOpened': {
      const pp = p as EventPayloadMap['ProposalOpened'];
      return (
        <div className="flex flex-col gap-1.5 text-sm leading-snug">
          <div className="font-medium">{pp.title}</div>
          <p className="text-foreground">{pp.body}</p>
          {pp.alternatives && pp.alternatives.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              <span className="uppercase tracking-wider">
                Rejected alternatives:
              </span>
              {pp.alternatives.map((a, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="font-mono">{i + 1}.</span>
                  <span>
                    <span className="font-medium text-foreground">
                      {a.name}
                    </span>{' '}
                    — {a.rejectedReason}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {decisionId && onOpenDecision ? (
            <button
              type="button"
              onClick={() => onOpenDecision(decisionId)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open decision page <ArrowUpRight className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>
      );
    }

    case 'ObjectionRaised': {
      const o = p as EventPayloadMap['ObjectionRaised'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <p className="text-foreground">{o.claimText}</p>
          <div className="text-[0.6875rem] text-muted-foreground">
            severity: <span className="font-mono">{o.severity}</span>
            {o.evidenceEventId ? ' · with evidence' : ' · no evidence attached'}
          </div>
          {decisionId && onOpenDecision ? (
            <button
              type="button"
              onClick={() => onOpenDecision(decisionId)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open decision <ArrowUpRight className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>
      );
    }

    case 'AlternativeProposed': {
      const a = p as EventPayloadMap['AlternativeProposed'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div className="font-medium">{a.name}</div>
          <p className="text-foreground">{a.body}</p>
        </div>
      );
    }

    case 'ExperimentRequested': {
      const e = p as EventPayloadMap['ExperimentRequested'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div>
            <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              kind:
            </span>{' '}
            <span className="font-mono">{e.kind}</span>
          </div>
          <p className="text-foreground">{e.purpose}</p>
          {e.targetClaimId ? (
            <div className="text-[0.6875rem] text-muted-foreground">
              target claim: <span className="font-mono">{e.targetClaimId}</span>
            </div>
          ) : null}
        </div>
      );
    }

    case 'ExperimentCompleted': {
      const e = p as EventPayloadMap['ExperimentCompleted'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div>
            <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              outcome:
            </span>{' '}
            <span className="font-mono">{e.outcome}</span>
          </div>
          <p className="text-foreground">{e.result}</p>
        </div>
      );
    }

    case 'BenchmarkReported': {
      const b = p as EventPayloadMap['BenchmarkReported'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-base font-semibold">
              {b.value}
              <span className="ml-0.5 text-xs text-muted-foreground">
                {b.unit}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              vs target <span className="font-mono">{b.target}{b.unit}</span>
            </span>
            <span
              className={
                b.passed
                  ? 'text-xs text-[var(--status-tested)]'
                  : 'text-xs text-[var(--status-falsified)]'
              }
            >
              {b.passed ? 'passed' : 'failed'}
            </span>
          </div>
          <div className="text-[0.6875rem] text-muted-foreground">
            metric: <span className="font-mono">{b.metric}</span>
          </div>
          {b.targetClaimId ? (
            <div className="text-[0.6875rem] text-muted-foreground">
              falsifies claim: <span className="font-mono">{b.targetClaimId}</span>
            </div>
          ) : null}
        </div>
      );
    }

    case 'RiskFlagged': {
      const r = p as EventPayloadMap['RiskFlagged'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div className="text-[0.6875rem] text-muted-foreground">
            severity: <span className="font-mono">{r.severity}</span>
            {' · '}scope: <span className="font-mono">{r.scopeType}/{r.scopeId}</span>
          </div>
          <p className="text-foreground">{r.description}</p>
        </div>
      );
    }

    case 'DecisionRecorded': {
      const d = p as EventPayloadMap['DecisionRecorded'];
      return (
        <div className="flex flex-col gap-1.5 text-sm leading-snug">
          <div>
            outcome:{' '}
            <span className="font-mono text-[var(--status-falsified)]">
              {d.outcome}
            </span>
          </div>
          <div className="font-medium">Chosen: {d.chosen}</div>
          <p className="text-foreground">{d.rationale}</p>
          {d.rejectedAlternatives.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              <span className="uppercase tracking-wider">
                Rejected alternatives:
              </span>
              {d.rejectedAlternatives.map((a, i) => (
                <div key={i} className="flex gap-1.5">
                  <ChevronRight className="size-3 opacity-50" aria-hidden />
                  <span>
                    <span className="font-medium text-foreground">
                      {a.name}
                    </span>{' '}
                    — {a.reason}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {decisionId && onOpenDecision ? (
            <button
              type="button"
              onClick={() => onOpenDecision(decisionId)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open decision <ArrowUpRight className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>
      );
    }

    case 'ClaimStatusChanged': {
      const c = p as EventPayloadMap['ClaimStatusChanged'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {c.claimId}
            </span>
            <span className="font-mono text-[var(--status-believed)]">
              {c.from}
            </span>
            <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
            <span className="font-mono text-[var(--status-falsified)]">
              {c.to}
            </span>
          </div>
          <p className="text-foreground">{c.reason}</p>
        </div>
      );
    }

    case 'GateBlocked': {
      const g = p as EventPayloadMap['GateBlocked'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div className="font-medium">
            {g.name} gate
          </div>
          <p className="text-foreground">{g.reason}</p>
        </div>
      );
    }

    case 'GatePassed': {
      const g = p as EventPayloadMap['GatePassed'];
      return (
        <div className="text-sm leading-snug">
          <span className="font-medium">{g.name} gate</span> passed.
        </div>
      );
    }

    case 'RoleAssigned': {
      const r = p as EventPayloadMap['RoleAssigned'];
      return (
        <div className="text-sm leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">{r.agentName}</span>{' '}
          assigned as <span className="font-mono">{r.role}</span>.
        </div>
      );
    }

    case 'AgentInstalled': {
      const a = p as EventPayloadMap['AgentInstalled'];
      return (
        <div className="text-sm leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">{a.name}</span>{' '}
          installed as <span className="font-mono">{a.role}</span>{' '}
          ({a.modelName}/{a.harnessName}).
          {a.teamName ? ` Assigned to ${a.teamName}.` : ''}
        </div>
      );
    }

    case 'EvidenceAttached': {
      const e = p as EventPayloadMap['EvidenceAttached'];
      return (
        <div className="flex flex-col gap-1 text-sm leading-snug">
          <div className="font-medium">{e.label}</div>
          <p className="text-foreground">{e.summary}</p>
          <div className="text-[0.6875rem] text-muted-foreground">
            type: <span className="font-mono">{e.evidenceType}</span> ·
            stance: <span className="font-mono">{e.supportsOrRefutes}</span>
          </div>
        </div>
      );
    }

    default:
      // generic fallback
      return (
        <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs leading-snug text-muted-foreground">
          {JSON.stringify(message.payload, null, 2)}
        </pre>
      );
  }
}

// Re-export hint for downstream status colors.
export type { ClaimStatus };
