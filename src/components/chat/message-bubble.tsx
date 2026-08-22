// Vuno — Message bubble
// Renders a single chat message projection. Typed events get a left-border accent
// in their statusHint color + an uppercase typeLabel. Per VLM QA feedback:
// - More vertical rhythm (alternating hover, better internal spacing)
// - Higher-contrast muted text
// - Role-colored avatar rings
// - Refined typed-message cards (not just a left-border)

'use client';

import { cn } from '@/lib/utils';
import { MemberAvatar, MemberBadge, type MemberKind } from '@/components/common/agent-avatar';
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
  kind: string; // 'independent' | 'personal_assistant'
  teamId: string | null;
  status: string;
  ownerHumanId: string | null;
}

interface User {
  id: string;
  name: string | null;
  email: string;
  isOrgOwner: boolean;
}

interface AgentsResponse {
  agents: Agent[];
}

interface UsersResponse {
  users: User[];
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
  const usersRes = useFetch<UsersResponse>('/api/users');
  const agents = useMemo(
    () => agentsRes.data?.agents ?? [],
    [agentsRes.data?.agents],
  );
  const users = useMemo(
    () => usersRes.data?.users ?? [],
    [usersRes.data?.users],
  );

  // Resolve the actor — human, independent agent, or personal assistant
  const { actorName, actorKind, actorRole, ownerName } = useMemo(() => {
    if (message.actorType === 'system') {
      return { actorName: 'system', actorKind: 'human' as MemberKind, actorRole: 'system', ownerName: undefined };
    }
    if (message.actorType === 'human') {
      const u = users.find((x) => x.id === message.actorUserId);
      const name = u?.name ?? u?.email ?? 'Kai';
      return {
        actorName: name,
        actorKind: 'human' as MemberKind,
        actorRole: u?.isOrgOwner ? 'Org Owner' : undefined,
        ownerName: undefined,
      };
    }
    // agent
    const a = agents.find((x) => x.id === message.actorAgentId);
    const kind: MemberKind =
      a?.kind === 'personal_assistant' ? 'personal_assistant' : 'independent';
    const owner = a?.ownerHumanId
      ? users.find((u) => u.id === a.ownerHumanId)?.name ?? users.find((u) => u.id === a.ownerHumanId)?.email
      : undefined;
    return {
      actorName: a?.name ?? 'Agent',
      actorKind: kind,
      actorRole: a?.role ?? '',
      ownerName: owner,
    };
  }, [agents, users, message.actorAgentId, message.actorUserId, message.actorType]);

  const isTyped = Boolean(message.typeLabel && message.type !== 'MessagePosted');
  const accent = hintColor(message.statusHint);
  const isSystem = message.actorType === 'system';
  const isAgent = actorKind !== 'human';
  const showBadge = isAgent && !isSystem; // show agent/personal badge for non-system agents

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
        'group flex gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40',
        isSystem && 'bg-muted/30',
        isTyped && 'bg-muted/20',
      )}
      aria-label={`Message from ${actorName} at ${time}`}
    >
      <div className="mt-0.5">
        <MemberAvatar
          name={actorName}
          kind={actorKind}
          size="md"
          health={isSystem ? 'warn' : 'ok'}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-semibold leading-none tracking-tight">
            {actorName}
          </span>
          {showBadge ? (
            <MemberBadge kind={actorKind} ownerName={ownerName} />
          ) : null}
          {actorRole && !isSystem && actorKind === 'human' ? (
            <span className="text-[0.6875rem] text-muted-foreground">
              {actorRole}
            </span>
          ) : null}
          {actorRole && !isSystem && actorKind !== 'human' ? (
            <span className="text-[0.6875rem] text-muted-foreground">
              {ROLE_LABELS[actorRole] ?? actorRole}
            </span>
          ) : null}
          {isTyped && message.typeLabel ? (
            <span
              className="rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-widest"
              style={
                accent
                  ? {
                      backgroundColor: `color-mix(in oklch, ${accent} 16%, transparent)`,
                      color: accent,
                    }
                  : undefined
              }
            >
              {message.typeLabel}
            </span>
          ) : null}
          <time
            className="ml-auto text-[0.6875rem] text-muted-foreground/90"
            style={{ color: 'oklch(0.72 0.01 250)' }}
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
          accent={accent}
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
  accent,
}: {
  message: ChatMessageProjection;
  onOpenDecision?: (id: string) => void;
  decisionId: string | null;
  accent: string | null;
}) {
  const p = message.payload as
    | (EventPayloadMap[keyof EventPayloadMap] & { body?: string })
    | null;

  // For typed messages with an accent color, wrap in a subtle bordered card.
  // Inlined as a fragment wrapper (not a component) to satisfy react-hooks lint.
  const cardStyle: React.CSSProperties = accent
    ? { borderColor: accent }
    : undefined;
  const cardClass =
    'flex flex-col gap-1.5 rounded-md border-l-2 bg-card/40 px-3 py-2.5';

  switch (message.type) {
    case 'MessagePosted':
      return <p className="text-sm leading-relaxed text-foreground">{p?.body}</p>;

    case 'ThreadReplyPosted':
      return (
        <p className="text-sm leading-relaxed text-foreground">{p?.body}</p>
      );

    case 'ObjectiveFiled': {
      const o = p as EventPayloadMap['ObjectiveFiled'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="text-sm font-semibold leading-snug">{o.title}</div>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-xs text-foreground/90">
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
              success criteria:{' '}
            </span>
            {o.successCriteria}
          </div>
          {o.constraints ? (
            <div className="text-xs text-foreground/80">
              <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                constraints:{' '}
              </span>
              {o.constraints}
            </div>
          ) : null}
          <div className="mt-0.5 flex flex-wrap gap-3 text-[0.6875rem] text-muted-foreground">
            {o.budget ? <span>budget: <span className="font-mono text-foreground/80">{o.budget}</span></span> : null}
            <span>autonomy: <span className="font-mono text-foreground/80">{o.autonomyLevel}</span></span>
            {o.owningDepartment ? (
              <span>routed: <span className="font-mono text-foreground/80">{o.owningDepartment}</span></span>
            ) : null}
          </div>
        </div>
      );
    }

    case 'ProposalOpened': {
      const pp = p as EventPayloadMap['ProposalOpened'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="text-sm font-semibold leading-snug">{pp.title}</div>
          <p className="text-sm leading-relaxed text-foreground">{pp.body}</p>
          {pp.alternatives && pp.alternatives.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              <span className="text-[0.625rem] uppercase tracking-widest">
                Rejected alternatives
              </span>
              {pp.alternatives.map((a, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="font-mono text-muted-foreground/80">{i + 1}.</span>
                  <span>
                    <span className="font-medium text-foreground/90">
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
              className="mt-1 inline-flex items-center gap-1 self-start rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
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
        <div className={cardClass} style={cardStyle}>
          <p className="text-sm leading-relaxed text-foreground">{o.claimText}</p>
          <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 font-mono">
              severity: {o.severity}
            </span>
            {o.evidenceEventId ? (
              <span className="text-[var(--status-tested)]">with evidence</span>
            ) : (
              <span className="text-[var(--status-asserted)]">no evidence attached</span>
            )}
          </div>
          {decisionId && onOpenDecision ? (
            <button
              type="button"
              onClick={() => onOpenDecision(decisionId)}
              className="mt-0.5 inline-flex items-center gap-1 self-start rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
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
        <div className={cardClass} style={cardStyle}>
          <div className="text-sm font-semibold leading-snug">{a.name}</div>
          <p className="text-sm leading-relaxed text-foreground">{a.body}</p>
        </div>
      );
    }

    case 'ExperimentRequested': {
      const e = p as EventPayloadMap['ExperimentRequested'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs">
              {e.kind}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{e.purpose}</p>
          {e.targetClaimId ? (
            <div className="text-[0.6875rem] text-muted-foreground">
              target claim: <span className="font-mono text-foreground/80">{e.targetClaimId}</span>
            </div>
          ) : null}
        </div>
      );
    }

    case 'ExperimentCompleted': {
      const e = p as EventPayloadMap['ExperimentCompleted'];
      const outcomeColor =
        e.outcome === 'supports'
          ? 'var(--status-tested)'
          : e.outcome === 'refutes'
            ? 'var(--status-falsified)'
            : 'var(--status-uncertain)';
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex items-center gap-2">
            <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
              outcome:
            </span>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold"
              style={{
                backgroundColor: `color-mix(in oklch, ${outcomeColor} 16%, transparent)`,
                color: outcomeColor,
              }}
            >
              {e.outcome}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{e.result}</p>
        </div>
      );
    }

    case 'BenchmarkReported': {
      const b = p as EventPayloadMap['BenchmarkReported'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-lg font-semibold leading-none">
              {b.value}
              <span className="ml-0.5 text-xs text-muted-foreground">
                {b.unit}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              vs target <span className="font-mono text-foreground/80">{b.target}{b.unit}</span>
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: `color-mix(in oklch, ${b.passed ? 'var(--status-tested)' : 'var(--status-falsified)'} 16%, transparent)`,
                color: b.passed ? 'var(--status-tested)' : 'var(--status-falsified)',
              }}
            >
              {b.passed ? 'passed' : 'failed'}
            </span>
          </div>
          <div className="text-[0.6875rem] text-muted-foreground">
            metric: <span className="font-mono text-foreground/80">{b.metric}</span>
          </div>
          {b.targetClaimId ? (
            <div className="text-[0.6875rem] text-muted-foreground">
              {b.passed ? 'supports' : 'falsifies'} claim:{' '}
              <span className="font-mono text-[var(--status-falsified)]">{b.targetClaimId}</span>
            </div>
          ) : null}
        </div>
      );
    }

    case 'RiskFlagged': {
      const r = p as EventPayloadMap['RiskFlagged'];
      const sevColor =
        r.severity === 'high' || r.severity === 'critical'
          ? 'var(--status-falsified)'
          : 'var(--status-asserted)';
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex items-center gap-2 text-[0.6875rem]">
            <span
              className="rounded px-1.5 py-0.5 font-mono font-semibold uppercase"
              style={{
                backgroundColor: `color-mix(in oklch, ${sevColor} 16%, transparent)`,
                color: sevColor,
              }}
            >
              {r.severity}
            </span>
            <span className="text-muted-foreground">
              scope: <span className="font-mono">{r.scopeType}/{r.scopeId}</span>
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{r.description}</p>
        </div>
      );
    }

    case 'DecisionRecorded': {
      const d = p as EventPayloadMap['DecisionRecorded'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: 'color-mix(in oklch, var(--status-falsified) 16%, transparent)',
                color: 'var(--status-falsified)',
              }}
            >
              {d.outcome}
            </span>
          </div>
          <div className="text-sm font-medium leading-snug">Chosen: {d.chosen}</div>
          <p className="text-sm leading-relaxed text-foreground">{d.rationale}</p>
          {d.rejectedAlternatives.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              <span className="text-[0.625rem] uppercase tracking-widest">
                Rejected alternatives
              </span>
              {d.rejectedAlternatives.map((a, i) => (
                <div key={i} className="flex gap-1.5">
                  <ChevronRight className="size-3 opacity-50" aria-hidden />
                  <span>
                    <span className="font-medium text-foreground/90">
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
              className="mt-1 inline-flex items-center gap-1 self-start rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              Open decision <ArrowUpRight className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>
      );
    }

    case 'ClaimStatusChanged': {
      const c = p as EventPayloadMap['ClaimStatusChanged'];
      const fromColor =
        c.from === 'believed'
          ? 'var(--status-believed)'
          : c.from === 'tested'
            ? 'var(--status-tested)'
            : 'var(--status-asserted)';
      const toColor =
        c.to === 'falsified'
          ? 'var(--status-falsified)'
          : c.to === 'tested'
            ? 'var(--status-tested)'
            : 'var(--status-uncertain)';
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              {c.claimId}
            </span>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold"
              style={{
                backgroundColor: `color-mix(in oklch, ${fromColor} 16%, transparent)`,
                color: fromColor,
              }}
            >
              {c.from}
            </span>
            <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
            <span
              className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold"
              style={{
                backgroundColor: `color-mix(in oklch, ${toColor} 16%, transparent)`,
                color: toColor,
              }}
            >
              {c.to}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{c.reason}</p>
        </div>
      );
    }

    case 'GateBlocked': {
      const g = p as EventPayloadMap['GateBlocked'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider animate-status-pulse"
              style={{
                backgroundColor: 'color-mix(in oklch, var(--status-falsified) 18%, transparent)',
                color: 'var(--status-falsified)',
              }}
            >
              ✗ blocked
            </span>
            <span className="text-sm font-semibold">{g.name} gate</span>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{g.reason}</p>
        </div>
      );
    }

    case 'GatePassed': {
      const g = p as EventPayloadMap['GatePassed'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: 'color-mix(in oklch, var(--status-tested) 18%, transparent)',
                color: 'var(--status-tested)',
              }}
            >
              ✓ passed
            </span>
            <span className="text-sm font-semibold">{g.name} gate</span>
          </div>
        </div>
      );
    }

    case 'RoleAssigned': {
      const r = p as EventPayloadMap['RoleAssigned'];
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{r.agentName}</span>{' '}
          assigned as{' '}
          <span className="font-mono text-[var(--status-believed)]">{r.role}</span>.
        </p>
      );
    }

    case 'AgentInstalled': {
      const a = p as EventPayloadMap['AgentInstalled'];
      return (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{a.name}</span>{' '}
          installed as <span className="font-mono">{a.role}</span>{' '}
          ({a.modelName}/{a.harnessName}).
          {a.teamName ? ` Assigned to ${a.teamName}.` : ''}
        </p>
      );
    }

    case 'EvidenceAttached': {
      const e = p as EventPayloadMap['EvidenceAttached'];
      return (
        <div className={cardClass} style={cardStyle}>
          <div className="text-sm font-medium leading-snug">{e.label}</div>
          <p className="text-sm leading-relaxed text-foreground">{e.summary}</p>
          <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
            <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono">
              {e.evidenceType}
            </span>
            <span
              style={{
                color:
                  e.supportsOrRefutes === 'supports'
                    ? 'var(--status-tested)'
                    : e.supportsOrRefutes === 'refutes'
                      ? 'var(--status-falsified)'
                      : 'var(--status-uncertain)',
              }}
            >
              {e.supportsOrRefutes}
            </span>
          </div>
        </div>
      );
    }

    default:
      // generic fallback
      return (
        <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground">
          {JSON.stringify(message.payload, null, 2)}
        </pre>
      );
  }
}

// Re-export hint for downstream status colors.
export type { ClaimStatus };
