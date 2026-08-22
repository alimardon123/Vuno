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
  FileText,
  Link as LinkIcon,
  Image as ImageIcon,
  Code2,
  BarChart3,
  File,
  ExternalLink,
  Reply,
  SmilePlus,
  Eye,
  Sparkles,
  Brain,
  GitBranch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useFetch } from '@/hooks/use-fetch';
import { useAppStore } from '@/store/app-store';
import { useMemo, useState } from 'react';

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
  const { openTrace } = useAppStore();
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

  // Post a reaction (emoji) to this message
  const postReaction = async (emoji: string) => {
    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ReactionAdded',
          payload: { emoji, targetEventId: message.id },
          channelId: message.scopeType === 'channel' ? message.scopeId : undefined,
        }),
      });
    } catch (e) {
      console.error('[reaction] failed:', e);
    }
  };

  // Post a reply to this message
  const postReply = async (body: string) => {
    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ThreadReplyPosted',
          payload: { body, parentId: message.id },
          channelId: message.scopeType === 'channel' ? message.scopeId : undefined,
        }),
      });
    } catch (e) {
      console.error('[reply] failed:', e);
    }
  };

  // Local reply input state
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyBody, setReplyBody] = useState('');

  return (
    <article
      className={cn(
        'group relative flex gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40',
        isSystem && 'bg-muted/30',
        isTyped && 'bg-muted/20',
      )}
      aria-label={`Message from ${actorName} at ${time}`}
    >
      {/* Hover actions — appear on message hover (top-right) */}
      <div className="absolute right-2 top-1 hidden gap-0.5 rounded-md border border-border/40 bg-card/80 px-0.5 py-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 md:flex">
        {/* Trace button — only on human MessagePosted (these trigger the collaboration loop) */}
        {message.type === 'MessagePosted' && message.actorType === 'human' ? (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="View causal trace"
            title="View causal trace — see how this message rippled through the org"
            onClick={() => openTrace(message.id)}
          >
            <GitBranch className="size-3" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Reply"
          title="Reply to this message"
          onClick={() => setShowReplyInput(!showReplyInput)}
        >
          <Reply className="size-3" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="React"
          title="React"
          onClick={() => {
            // Post a thumbs-up reaction
            void postReaction('👍');
          }}
        >
          <SmilePlus className="size-3" aria-hidden />
        </button>
        {/* Quick reactions */}
        <div className="flex gap-0.5">
          {['👍', '❤️', '🚀', '⚠️'].map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded p-0.5 text-xs hover:bg-accent"
              onClick={() => void postReaction(emoji)}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
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

        {/* Inline reply input — shown when Reply is clicked */}
        {showReplyInput ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              type="text"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder={`Reply to ${actorName}…`}
              className="h-7 flex-1 rounded-md border border-border/60 bg-card/60 px-2 text-xs placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && replyBody.trim()) {
                  void postReply(replyBody.trim());
                  setReplyBody('');
                  setShowReplyInput(false);
                }
                if (e.key === 'Escape') {
                  setShowReplyInput(false);
                  setReplyBody('');
                }
              }}
              autoFocus
            />
            <button
              type="button"
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!replyBody.trim()}
              onClick={() => {
                if (replyBody.trim()) {
                  void postReply(replyBody.trim());
                  setReplyBody('');
                  setShowReplyInput(false);
                }
              }}
            >
              Send
            </button>
          </div>
        ) : null}
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

    case 'AgentThought': {
      const t = p as EventPayloadMap['AgentThought'];
      const thoughtColor =
        t.thoughtType === 'doubt' ? 'var(--status-asserted)' :
        t.thoughtType === 'question' ? 'var(--status-uncertain)' :
        t.thoughtType === 'hypothesis' ? 'var(--status-believed)' :
        t.thoughtType === 'conclusion' ? 'var(--status-tested)' :
        'var(--muted-foreground)';
      return (
        <div
          className="flex items-start gap-2 rounded-md border-l-2 bg-muted/20 px-3 py-2 italic"
          style={{ borderColor: `color-mix(in oklch, ${thoughtColor} 40%, transparent)` }}
        >
          <span
            className="rounded px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider not-italic"
            style={{
              backgroundColor: `color-mix(in oklch, ${thoughtColor} 14%, transparent)`,
              color: thoughtColor,
            }}
          >
            {t.thoughtType}
          </span>
          <div className="flex-1">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t.content}
            </p>
            {t.relatedThoughtId ? (
              <p className="mt-0.5 text-[0.625rem] not-italic text-muted-foreground/60">
                ↳ replying to: <span className="font-mono">{t.relatedThoughtId.slice(0, 12)}…</span>
              </p>
            ) : null}
          </div>
        </div>
      );
    }

    case 'SharedItem': {
      const s = p as EventPayloadMap['SharedItem'];
      // Map item type to icon + accent color
      const itemConfig: Record<string, { icon: LucideIcon; color: string }> = {
        file: { icon: File, color: 'var(--status-believed)' },
        report: { icon: FileText, color: 'var(--status-tested)' },
        url: { icon: LinkIcon, color: 'var(--status-believed)' },
        image: { icon: ImageIcon, color: 'var(--status-asserted)' },
        code: { icon: Code2, color: 'var(--status-uncertain)' },
        data: { icon: BarChart3, color: 'var(--status-tested)' },
      };
      const cfg = itemConfig[s.itemType] ?? { icon: File, color: 'var(--muted-foreground)' };
      return (
        <div className={cardClass} style={{ ...cardStyle, borderColor: `color-mix(in oklch, ${cfg.color} 40%, transparent)` }}>
          <div className="flex items-start gap-2">
            <div
              className="grid size-8 shrink-0 place-items-center rounded-md"
              style={{ backgroundColor: `color-mix(in oklch, ${cfg.color} 14%, transparent)` }}
            >
              <cfg.icon className="size-4" style={{ color: cfg.color }} aria-hidden />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{s.title}</span>
                <span
                  className="rounded px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider"
                  style={{ backgroundColor: `color-mix(in oklch, ${cfg.color} 14%, transparent)`, color: cfg.color }}
                >
                  {s.itemType}
                </span>
              </div>
              {s.description ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              ) : null}
              {s.fileName ? (
                <div className="text-[0.6875rem] text-muted-foreground">
                  file: <span className="font-mono text-foreground/80">{s.fileName}</span>
                  {s.mimeType ? <span className="ml-2">· {s.mimeType}</span> : null}
                </div>
              ) : null}
              {s.content ? (
                <pre className="mt-1 overflow-x-auto rounded-md bg-muted/30 p-2 text-xs leading-relaxed text-foreground/80 scrollbar-sleek">
                  {s.content.length > 300 ? s.content.slice(0, 300) + '…' : s.content}
                </pre>
              ) : null}
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="size-3" aria-hidden />
                  {s.url.length > 60 ? s.url.slice(0, 60) + '…' : s.url}
                </a>
              ) : null}
              {s.meta ? (
                <div className="flex flex-wrap gap-2 text-[0.6875rem] text-muted-foreground/70">
                  {Object.entries(s.meta).map(([k, v]) => (
                    <span key={k}>{k}: <span className="font-mono">{v}</span></span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    case 'ReactionAdded': {
      const r = p as EventPayloadMap['ReactionAdded'];
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-base">{r.emoji}</span>
          <span>reacted to <span className="font-mono text-foreground/60">{r.targetEventId.slice(0, 12)}…</span></span>
        </div>
      );
    }

    case 'PreemptIssued': {
      const pre = p as EventPayloadMap['PreemptIssued'];
      const urgencyColor = pre.urgency === 'high' ? 'var(--status-falsified)' : pre.urgency === 'medium' ? 'var(--status-asserted)' : 'var(--status-uncertain)';
      return (
        <div
          className="flex items-start gap-2 rounded-md border-l-2 bg-[var(--status-falsified)]/[0.06] px-3 py-2"
          style={{ borderColor: urgencyColor }}
        >
          <span
            className="rounded px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider animate-status-pulse"
            style={{ backgroundColor: `color-mix(in oklch, ${urgencyColor} 14%, transparent)`, color: urgencyColor }}
          >
            ⚡ preempt
          </span>
          <div className="flex-1">
            <p className="text-sm leading-relaxed text-foreground/90">
              <span className="font-medium">{pre.interruptingAgentName}</span> interrupted{' '}
              <span className="font-medium">{pre.targetAgentName}</span>
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{pre.reason}</p>
          </div>
        </div>
      );
    }

    case 'AttentionWakeup': {
      // The "magic moment" — an agent noticed this message and is engaging.
      // Rendered as a subtle, animated "noticed this" badge with confidence + matched keywords.
      const w = p as EventPayloadMap['AttentionWakeup'];
      const confidencePct = Math.round(w.confidence * 100);
      const highConfidence = confidencePct >= 70;
      const accentColor = 'var(--status-believed)'; // sky-blue — calm, not alarming
      return (
        <div
          className="flex items-start gap-2 rounded-md border-l-2 bg-[var(--status-believed)]/[0.06] px-3 py-2"
          style={{ borderColor: accentColor }}
        >
          <span
            className="mt-0.5 inline-flex size-4 items-center justify-center text-[var(--status-believed)] animate-status-pulse"
            aria-hidden
          >
            <Eye className="size-3.5" />
          </span>
          <div className="flex-1">
            <p className="text-sm leading-relaxed text-foreground/90">
              <span className="font-medium">{w.agentName}</span>{' '}
              <span className="text-muted-foreground">
                noticed this — topic: <span className="font-mono text-foreground/70">{w.topic}</span>
              </span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {w.matchedKeywords.slice(0, 4).map((kw) => (
                <span
                  key={kw}
                  className="rounded bg-muted/70 px-1.5 py-0 font-mono text-[0.625rem] text-muted-foreground"
                >
                  {kw}
                </span>
              ))}
              <span
                className={cn(
                  'ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider',
                  highConfidence ? 'text-[var(--status-believed)]' : 'text-muted-foreground',
                )}
                title={`confidence: ${confidencePct}%`}
              >
                <Sparkles className="size-2.5" aria-hidden />
                {confidencePct}%
              </span>
            </div>
            <p className="mt-1 text-[0.6875rem] italic text-muted-foreground/80">
              engaging — typing a brief observation…
            </p>
          </div>
        </div>
      );
    }

    case 'MemoryUpdated': {
      // The PA silently learned something about the owner from this message.
      // Rendered as a subtle "🧠 learned" badge — the second magic moment
      // (after the attention router's "noticed this" badge).
      // Per the "Beautiful" principle: amber accent (warm, learned), Brain icon,
      // fact-type pill, evidence link.
      const m = p as EventPayloadMap['MemoryUpdated'];
      const confidencePct = Math.round(m.confidence * 100);
      const isNew = m.oldValue === null;
      const accentColor = 'var(--status-asserted)'; // amber — warm, learned
      const factTypeLabel = m.factType === 'focus_area' ? 'focus area'
        : m.factType === 'interest' ? 'interest'
        : m.factType === 'sentiment' ? 'sentiment'
        : 'preference';
      return (
        <div
          className="flex items-start gap-2 rounded-md border-l-2 bg-[var(--status-asserted)]/[0.06] px-3 py-2"
          style={{ borderColor: accentColor }}
        >
          <span
            className="mt-0.5 inline-flex size-4 items-center justify-center text-[var(--status-asserted)] animate-status-pulse"
            aria-hidden
          >
            <Brain className="size-3.5" />
          </span>
          <div className="flex-1">
            <p className="text-sm leading-relaxed text-foreground/90">
              <span className="font-medium">{m.agentName}</span>{' '}
              <span className="text-muted-foreground">
                {isNew ? 'learned a new' : 'updated an'} {factTypeLabel} about{' '}
                <span className="font-medium text-foreground/80">{m.ownerName}</span>
              </span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0 font-mono text-[0.625rem] uppercase tracking-wider"
                style={{
                  backgroundColor: `color-mix(in oklch, ${accentColor} 14%, transparent)`,
                  color: accentColor,
                }}
              >
                {m.key}
              </span>
              <span className="rounded bg-muted/70 px-1.5 py-0 font-mono text-[0.625rem] text-foreground/80">
                {m.value}
              </span>
              {m.oldValue ? (
                <span className="text-[0.625rem] text-muted-foreground/70">
                  was: <span className="font-mono line-through">{m.oldValue.length > 40 ? m.oldValue.slice(0, 40) + '…' : m.oldValue}</span>
                </span>
              ) : null}
              <span
                className="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider text-[var(--status-asserted)]"
                title={`confidence: ${confidencePct}%`}
              >
                <Sparkles className="size-2.5" aria-hidden />
                {confidencePct}%
              </span>
            </div>
            <p className="mt-1 text-[0.6875rem] italic text-muted-foreground/80">
              {isNew
                ? `noted from your message — saved to ${m.ownerName}'s profile`
                : `refined the model — ${m.ownerName}'s ${factTypeLabel} changed`}
            </p>
          </div>
        </div>
      );
    }

    case 'PaProactiveNote': {
      // The PA's proactive note — weaves learned facts into a natural message.
      // This closes the learn→reference loop: Bob learns (MemoryUpdated badges)
      // THEN Bob speaks, referencing what he just learned.
      // Per the "Beautiful" principle: warm amber accent (PA color), Brain icon
      // "proactive" badge, body text, and 🧠 memory pills linking to the
      // MemoryUpdated events that established each fact.
      const n = p as EventPayloadMap['PaProactiveNote'];
      const accentColor = 'var(--status-asserted)'; // amber — warm, personal
      return (
        <div
          className="flex flex-col gap-2 rounded-md border-l-2 bg-[var(--status-asserted)]/[0.06] px-3 py-2.5"
          style={{ borderColor: accentColor }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: `color-mix(in oklch, ${accentColor} 14%, transparent)`,
                color: accentColor,
              }}
            >
              <Brain className="size-2.5" aria-hidden />
              proactive
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">
              {n.agentName} → {n.ownerName}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">{n.body}</p>
          {n.memoryReferences.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground/70">
                referencing:
              </span>
              {n.memoryReferences.map((ref, i) => {
                const refColor = ref.factType === 'interest' ? 'var(--status-believed)'
                  : ref.factType === 'focus_area' ? 'var(--status-tested)'
                  : ref.factType === 'sentiment' ? 'var(--status-asserted)'
                  : 'var(--status-asserted)';
                const factLabel = ref.factType === 'focus_area' ? 'focus'
                  : ref.factType === 'interest' ? 'interest'
                  : ref.factType === 'sentiment' ? 'sentiment'
                  : 'pref';
                return (
                  <span
                    key={`${ref.memoryEventId}-${i}`}
                    className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.625rem]"
                    style={{
                      borderColor: `color-mix(in oklch, ${refColor} 30%, transparent)`,
                      backgroundColor: `color-mix(in oklch, ${refColor} 8%, transparent)`,
                    }}
                    title={`learned in event ${ref.memoryEventId}`}
                  >
                    <Brain className="size-2.5" style={{ color: refColor }} aria-hidden />
                    <span className="font-mono uppercase tracking-wider" style={{ color: refColor }}>
                      {factLabel}
                    </span>
                    <span className="font-mono text-foreground/70">
                      {ref.key} → {ref.value}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    }

    case 'AgentHandoff': {
      // ACP — agent-to-agent delegation. Bob (or any agent) hands off to an
      // expert with curated context. Rendered as a "delegation" badge showing
      // the chain: from → to, the request, and the context summary.
      // Per the "Beautiful" principle: warm amber accent (delegation = action),
      // Forward arrow icon, italic context summary like a colleague's note.
      const h = p as EventPayloadMap['AgentHandoff'];
      const accentColor = 'var(--status-asserted)'; // amber — warm, action-oriented
      return (
        <div
          className="flex flex-col gap-2 rounded-md border-l-2 bg-[var(--status-asserted)]/[0.06] px-3 py-2.5"
          style={{ borderColor: accentColor }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0 text-[0.5625rem] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: `color-mix(in oklch, ${accentColor} 14%, transparent)`,
                color: accentColor,
              }}
            >
              <ArrowUpRight className="size-2.5" aria-hidden />
              handoff
            </span>
            <span className="text-sm font-medium text-foreground/90">{h.fromAgentName}</span>
            <span className="text-muted-foreground" aria-hidden>
              →
            </span>
            <span className="text-sm font-medium text-foreground/90">{h.toAgentName}</span>
            <span className="text-[0.6875rem] text-muted-foreground">
              ({h.toRole})
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">
            <span className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground/70">
              request:
            </span>{' '}
            {h.request}
          </p>
          <p className="text-[0.75rem] italic leading-relaxed text-muted-foreground/85">
            <span className="not-italic font-medium text-muted-foreground/70">context:</span>{' '}
            {h.contextSummary}
          </p>
        </div>
      );
    }

    case 'ThreadReplyPosted': {
      const t = p as EventPayloadMap['ThreadReplyPosted'];
      return (
        <div className="flex flex-col gap-1 border-l-2 border-border/40 pl-3">
          <span className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground/60">reply</span>
          <p className="text-sm leading-relaxed text-foreground">{t.body}</p>
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
