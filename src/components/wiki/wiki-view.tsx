// AI Org OS — Project Wiki view
// Per ADR-0005: the wiki is GENERATED from the ledger, not maintained beside it.
// Pure projection of /api/wiki — no separate WikiPage table. Always current.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { StatusPill } from '@/components/common/status-pill';
import { AgentAvatar } from '@/components/common/agent-avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import {
  FileText,
  Target,
  GitPullRequest,
  AlertTriangle,
  CircleHelp,
  Users,
  History,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ListChecks,
  Microscope,
  ShieldQuestion,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABELS } from '@/lib/agents/types';
import type { ClaimStatus } from '@/lib/events/types';

// ─── API response types ─────────────────────────────────────────────────────
interface WikiDecision {
  id: string;
  title: string;
  state: string;
  outcome: string | null;
  proposerAgentName: string | null;
  proposerAgentRole: string | null;
  createdAt: string;
  proposalBody: string | null;
  alternatives: Array<{ name: string; rejectedReason: string }> | null;
  rejectedAlternatives: Array<{ name: string; reason: string }> | null;
  rationale: string | null;
  participants: Array<{
    agentId: string;
    agentName: string;
    role: string;
    roleLabel: string;
  }>;
  evidenceCount: number;
  objectionCount: number;
  experimentCount: number;
  benchmarkCount: number;
  statusChecks: Array<{
    id: string;
    name: string;
    state: string;
    policy: string;
    reason: string | null;
  }>;
}

interface WikiClaim {
  id: string;
  statement: string;
  status: string;
  scopeType: string;
  scopeId: string;
  provenanceAgentId: string | null;
  provenanceAgentName: string | null;
  provenanceAgentRole: string | null;
  evidenceCount: number;
  contradictsCount: number;
  statusReason: string | null;
  updatedAt: string;
}

interface WikiRisk {
  id: string;
  severity: string;
  description: string;
  flaggedByAgentName: string | null;
  flaggedAt: string;
  claimId: string | null;
}

interface WikiRetrospective {
  agentName: string;
  agentRole: string;
  body: string;
  postedAt: string;
}

interface WikiParticipant {
  agentId: string;
  agentName: string;
  agentRole: string;
  roleLabel: string;
  proposalCount: number;
  objectionCount: number;
  evidenceCount: number;
}

interface WikiResponse {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  } | null;
  objective: {
    id: string;
    title: string;
    successCriteria: string;
    constraints: string | null;
    budget: string | null;
    autonomyLevel: string;
    status: string;
  } | null;
  decisions: WikiDecision[];
  claimsByStatus: Record<string, WikiClaim[]>;
  claimsTotal: number;
  openRisks: WikiRisk[];
  unresolvedUncertainties: WikiClaim[];
  retrospective: WikiRetrospective[];
  participants: WikiParticipant[];
  eventTimeline: Array<{
    seq: number;
    type: string;
    actorType: string;
    actorAgentName: string | null;
    createdAt: string;
    summary: string;
  }>;
  generatedAt: string;
  lastEventAt: string | null;
  totalEventCount: number;
}

// Status icons per claim status
function statusToColor(status: string): ClaimStatus {
  return status as ClaimStatus;
}

// ─── Wiki view ──────────────────────────────────────────────────────────────
export function WikiView() {
  const wikiRes = useFetch<WikiResponse>('/api/wiki', { intervalMs: 15000 });
  const { setActiveDecision } = useAppStore();

  if (wikiRes.loading) {
    return <WikiSkeleton />;
  }
  if (!wikiRes.data || !wikiRes.data.project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-base font-medium">No project yet</span>
        <p className="text-sm text-muted-foreground">
          The wiki is generated from project-scoped ledger entries. File an
          objective first to see this page come alive.
        </p>
      </div>
    );
  }

  const wiki = wikiRes.data;
  const generatedAt = new Date(wiki.generatedAt);
  const lastEventAt = wiki.lastEventAt ? new Date(wiki.lastEventAt) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-border/70 px-6 py-4">
        <div className="flex items-center gap-3">
          <FileText className="size-5 text-primary" aria-hidden />
          <div className="flex-1">
            <h1 className="text-xl font-semibold leading-tight tracking-tight">
              {wiki.project.name}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-mono">{wiki.project.slug}</span>
              {wiki.project.description ? ` · ${wiki.project.description}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">
              <Sparkles className="size-3" aria-hidden />
              Generated from the ledger
            </span>
            <span>
              {wiki.totalEventCount} events · updated{' '}
              <time title={format(generatedAt, 'PPpp')}>
                {formatDistanceToNow(generatedAt, { addSuffix: true })}
              </time>
            </span>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 scrollbar-sleek">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
          {/* Objective summary */}
          {wiki.objective ? (
            <ObjectiveCard objective={wiki.objective} />
          ) : null}

          {/* Status summary strip */}
          <StatusSummaryStrip
            claimsTotal={wiki.claimsTotal}
            claimsByStatus={wiki.claimsByStatus}
            openRisksCount={wiki.openRisks.length}
            decisionsCount={wiki.decisions.length}
          />

          {/* Architecture decisions */}
          <Section
            icon={GitPullRequest}
            title="Architecture Decisions"
            count={wiki.decisions.length}
          >
            <div className="flex flex-col gap-3">
              {wiki.decisions.length === 0 ? (
                <EmptyHint text="No decisions recorded yet." />
              ) : (
                wiki.decisions.map((d) => (
                  <DecisionCard
                    key={d.id}
                    decision={d}
                    onOpen={() => setActiveDecision(d.id)}
                  />
                ))
              )}
            </div>
          </Section>

          {/* Claims by status — the distinctive wiki section */}
          <Section
            icon={ListChecks}
            title="Claims by Status"
            count={wiki.claimsTotal}
          >
            <ClaimsByStatus claimsByStatus={wiki.claimsByStatus} />
          </Section>

          {/* Open risks */}
          <Section
            icon={AlertTriangle}
            title="Open Risks"
            count={wiki.openRisks.length}
          >
            {wiki.openRisks.length === 0 ? (
              <EmptyHint text="No open risks. Gates are clear." />
            ) : (
              <div className="flex flex-col gap-2">
                {wiki.openRisks.map((r) => (
                  <RiskRow key={r.id} risk={r} />
                ))}
              </div>
            )}
          </Section>

          {/* Unresolved uncertainties */}
          <Section
            icon={CircleHelp}
            title="Unresolved Uncertainties"
            count={wiki.unresolvedUncertainties.length}
          >
            {wiki.unresolvedUncertainties.length === 0 ? (
              <EmptyHint text="No unresolved uncertainties. Everything has been tested, falsified, or is believed." />
            ) : (
              <div className="flex flex-col gap-2">
                {wiki.unresolvedUncertainties.map((c) => (
                  <ClaimRow key={c.id} claim={c} />
                ))}
              </div>
            )}
          </Section>

          {/* Retrospective (HR/Meta) */}
          <Section
            icon={Microscope}
            title="Organizational Retrospective"
            count={wiki.retrospective.length}
            subtitle="Authored by the HR / Meta team"
          >
            {wiki.retrospective.length === 0 ? (
              <EmptyHint text="HR has not logged a retrospective yet." />
            ) : (
              <div className="flex flex-col gap-3">
                {wiki.retrospective.map((r, i) => (
                  <RetrospectiveCard key={i} retrospective={r} />
                ))}
              </div>
            )}
          </Section>

          {/* Participants */}
          <Section icon={Users} title="Participants" count={wiki.participants.length}>
            {wiki.participants.length === 0 ? (
              <EmptyHint text="No participants yet." />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {wiki.participants.map((p) => (
                  <ParticipantCard key={p.agentId} participant={p} />
                ))}
              </div>
            )}
          </Section>

          {/* Event timeline */}
          <Section
            icon={History}
            title="Event Timeline"
            count={wiki.totalEventCount}
            subtitle="Every append to the spine for this project"
          >
            <Timeline events={wiki.eventTimeline} />
          </Section>

          {/* Footer of the wiki page */}
          <div className="mt-4 border-t border-dashed border-border/60 pt-4 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <Sparkles className="size-3" aria-hidden />
              This page is a pure projection of the ledger. It is never
              hand-maintained — when a decision is reopened or a claim's status
              changes, this page updates.
            </p>
            {lastEventAt ? (
              <p className="mt-1">
                Last event:{' '}
                <time title={format(lastEventAt, 'PPpp')}>
                  {formatDistanceToNow(lastEventAt, { addSuffix: true })}
                </time>
              </p>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────
function WikiSkeleton() {
  return (
    <div className="p-6">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <div className="mt-6 grid gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}

function ObjectiveCard({
  objective,
}: {
  objective: NonNullable<WikiResponse['objective']>;
}) {
  return (
    <Card className="overflow-hidden border-l-2 border-l-primary/60 bg-primary/[0.04] shadow-sm transition-colors hover:bg-primary/[0.06]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Target className="size-4 text-primary" aria-hidden />
          Objective
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {objective.id}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="text-base font-semibold leading-snug">
          {objective.title}
        </div>
        <div className="rounded-md bg-card/60 px-3 py-2 font-mono text-xs">
          <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
            success criteria
          </span>
          <div className="mt-0.5 text-foreground/90">
            {objective.successCriteria}
          </div>
        </div>
        {objective.constraints ? (
          <div className="text-xs leading-relaxed text-muted-foreground">
            <span className="text-[0.625rem] uppercase tracking-widest">
              constraints:{' '}
            </span>
            {objective.constraints}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3 text-[0.6875rem] text-muted-foreground">
          {objective.budget ? (
            <span>
              budget:{' '}
              <span className="font-mono text-foreground/80">
                {objective.budget}
              </span>
            </span>
          ) : null}
          <span>
            autonomy:{' '}
            <span className="font-mono text-foreground/80">
              {objective.autonomyLevel}
            </span>
          </span>
          <span>
            status:{' '}
            <span className="font-mono text-foreground/80">
              {objective.status}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusSummaryStrip({
  claimsTotal,
  claimsByStatus,
  openRisksCount,
  decisionsCount,
}: {
  claimsTotal: number;
  claimsByStatus: Record<string, WikiClaim[]>;
  openRisksCount: number;
  decisionsCount: number;
}) {
  const items = [
    { label: 'decisions', count: decisionsCount, color: 'var(--status-believed)' },
    {
      label: 'claims',
      count: claimsTotal,
      color: 'var(--status-uncertain)',
    },
    {
      label: 'asserted',
      count: claimsByStatus.asserted?.length ?? 0,
      color: 'var(--status-asserted)',
    },
    {
      label: 'believed',
      count: claimsByStatus.believed?.length ?? 0,
      color: 'var(--status-believed)',
    },
    {
      label: 'tested',
      count: claimsByStatus.tested?.length ?? 0,
      color: 'var(--status-tested)',
    },
    {
      label: 'falsified',
      count: claimsByStatus.falsified?.length ?? 0,
      color: 'var(--status-falsified)',
    },
    {
      label: 'risks',
      count: openRisksCount,
      color: openRisksCount > 0 ? 'var(--status-falsified)' : 'var(--status-tested)',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {items.map((it) => (
        <div
          key={it.label}
          className="flex flex-col gap-1 rounded-md border border-border/60 bg-card/40 px-3 py-2"
        >
          <span
            className="font-mono text-lg font-semibold leading-none"
            style={{ color: it.color }}
          >
            {it.count}
          </span>
          <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
            {it.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function DecisionCard({
  decision,
  onOpen,
}: {
  decision: WikiDecision;
  onOpen: () => void;
}) {
  const statePillStatus =
    decision.outcome === 'falsified' || decision.outcome === 'rejected'
      ? 'falsified'
      : decision.outcome === 'accepted'
        ? 'tested'
        : decision.state === 'contested'
          ? 'asserted'
          : 'uncertain';

  const blockedGates = decision.statusChecks.filter(
    (g) => g.state === 'blocked',
  );
  const passedGates = decision.statusChecks.filter(
    (g) => g.state === 'passed',
  );

  return (
    <Card className="overflow-hidden transition-colors hover:bg-accent/20">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2">
          <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex-1">
            <CardTitle className="text-sm font-semibold leading-snug">
              {decision.title}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{decision.id}</span>
              {decision.proposerAgentName
                ? ` · opened by ${decision.proposerAgentName}`
                : ''}
              {' · '}
              {formatDistanceToNow(new Date(decision.createdAt), {
                addSuffix: true,
              })}
            </p>
          </div>
          <StatusPill status={statePillStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {decision.proposalBody ? (
          <div>
            <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
              proposal
            </span>
            <p className="mt-1.5 leading-relaxed text-foreground/90">
              {decision.proposalBody}
            </p>
          </div>
        ) : null}

        {decision.rejectedAlternatives && decision.rejectedAlternatives.length > 0 ? (
          <div>
            <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
              rejected alternatives
            </span>
            <ul className="mt-1 flex flex-col gap-1">
              {decision.rejectedAlternatives.map((a, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-0.5 border-l-2 border-muted pl-2"
                >
                  <span className="font-medium text-foreground/90">{a.name}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{a.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {decision.rationale ? (
          <div>
            <span className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
              rationale
            </span>
            <p className="mt-1.5 leading-relaxed text-foreground/90">
              {decision.rationale}
            </p>
          </div>
        ) : null}

        {/* Gate summary */}
        <div className="flex flex-wrap items-center gap-1.5">
          {decision.statusChecks.map((g) => (
            <span
              key={g.id}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: `color-mix(in oklch, ${
                  g.state === 'passed'
                    ? 'var(--status-tested)'
                    : g.state === 'blocked'
                      ? 'var(--status-falsified)'
                      : 'var(--status-uncertain)'
                } 16%, transparent)`,
                color:
                  g.state === 'passed'
                    ? 'var(--status-tested)'
                    : g.state === 'blocked'
                      ? 'var(--status-falsified)'
                      : 'var(--status-uncertain)',
              }}
            >
              {g.state === 'passed' ? '✓' : g.state === 'blocked' ? '✗' : '○'}{' '}
              {g.name}
            </span>
          ))}
        </div>

        {/* Counts */}
        <div className="flex flex-wrap items-center gap-3 text-[0.6875rem] text-muted-foreground">
          <span>participants: <span className="font-mono text-foreground/80">{decision.participants.length}</span></span>
          <span>evidence: <span className="font-mono text-foreground/80">{decision.evidenceCount}</span></span>
          <span>objections: <span className="font-mono text-foreground/80">{decision.objectionCount}</span></span>
          <span>experiments: <span className="font-mono text-foreground/80">{decision.experimentCount}</span></span>
          <span>benchmarks: <span className="font-mono text-foreground/80">{decision.benchmarkCount}</span></span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 self-start"
          onClick={onOpen}
        >
          Open decision page <ChevronRight className="size-3" aria-hidden />
        </Button>
      </CardContent>
    </Card>
  );
}

function ClaimsByStatus({
  claimsByStatus,
}: {
  claimsByStatus: Record<string, WikiClaim[]>;
}) {
  const order: Array<{ key: string; label: string; status: ClaimStatus }> = [
    { key: 'tested', label: 'Tested', status: 'tested' },
    { key: 'believed', label: 'Believed', status: 'believed' },
    { key: 'falsified', label: 'Falsified', status: 'falsified' },
    { key: 'asserted', label: 'Asserted', status: 'asserted' },
    { key: 'uncertain', label: 'Uncertain', status: 'uncertain' },
  ];
  return (
    <div className="flex flex-col gap-3">
      {order.map(({ key, label, status }) => {
        const list = claimsByStatus[key] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <StatusPill status={status} />
              <span className="text-xs text-muted-foreground">
                {list.length} {list.length === 1 ? 'claim' : 'claims'}
              </span>
            </div>
            <div className="flex flex-col gap-2 border-l-2 pl-3" style={{
              borderColor: `color-mix(in oklch, var(--status-${status}) 40%, transparent)`,
            }}>
              {list.map((c) => (
                <ClaimRow key={c.id} claim={c} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClaimRow({ claim }: { claim: WikiClaim }) {
  return (
    <div className="rounded-md border border-border/40 bg-card/30 px-3 py-2.5 text-sm transition-colors hover:bg-card/60 hover:border-border/70">
      <div className="flex items-start gap-2">
        <StatusPill status={statusToColor(claim.status)} />
        <p className="flex-1 leading-relaxed text-foreground/90">
          {claim.statement}
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
        <span className="font-mono">{claim.id}</span>
        {claim.provenanceAgentName ? (
          <span>
            · {claim.provenanceAgentName}{' '}
            {claim.provenanceAgentRole
              ? `(${ROLE_LABELS[claim.provenanceAgentRole] ?? claim.provenanceAgentRole})`
              : ''}
          </span>
        ) : null}
        <span>· evidence: <span className="font-mono">{claim.evidenceCount}</span></span>
        {claim.contradictsCount > 0 ? (
          <span>· contradicts: <span className="font-mono">{claim.contradictsCount}</span></span>
        ) : null}
        <span className="ml-auto">
          <time title={format(new Date(claim.updatedAt), 'PPpp')}>
            {formatDistanceToNow(new Date(claim.updatedAt), { addSuffix: true })}
          </time>
        </span>
      </div>
      {claim.statusReason ? (
        <p className="mt-1 text-xs italic text-muted-foreground">
          {claim.statusReason}
        </p>
      ) : null}
    </div>
  );
}

function RiskRow({ risk }: { risk: WikiRisk }) {
  const sevColor =
    risk.severity === 'high' || risk.severity === 'critical'
      ? 'var(--status-falsified)'
      : 'var(--status-asserted)';
  return (
    <div className="rounded-md border-l-2 bg-card/30 px-3 py-2.5 text-sm transition-colors hover:bg-card/60" style={{ borderColor: sevColor }}>
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase"
          style={{
            backgroundColor: `color-mix(in oklch, ${sevColor} 16%, transparent)`,
            color: sevColor,
          }}
        >
          {risk.severity}
        </span>
        {risk.flaggedByAgentName ? (
          <span className="text-xs text-muted-foreground">
            flagged by <span className="font-medium text-foreground/90">{risk.flaggedByAgentName}</span>
          </span>
        ) : null}
        <span className="ml-auto text-[0.6875rem] text-muted-foreground">
          <time title={format(new Date(risk.flaggedAt), 'PPpp')}>
            {formatDistanceToNow(new Date(risk.flaggedAt), { addSuffix: true })}
          </time>
        </span>
      </div>
      <p className="mt-1 leading-relaxed text-foreground/90">{risk.description}</p>
      {risk.claimId ? (
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">
          linked claim: <span className="font-mono">{risk.claimId}</span>
        </p>
      ) : null}
    </div>
  );
}

function RetrospectiveCard({
  retrospective,
}: {
  retrospective: WikiRetrospective;
}) {
  return (
    <Card className="transition-colors hover:bg-accent/20">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <AgentAvatar
            name={retrospective.agentName}
            role={retrospective.agentRole}
            size="sm"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold leading-none">
              {retrospective.agentName}
            </div>
            <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
              {ROLE_LABELS[retrospective.agentRole] ?? retrospective.agentRole}
              {' · '}
              <time title={format(new Date(retrospective.postedAt), 'PPpp')}>
                {formatDistanceToNow(new Date(retrospective.postedAt), {
                  addSuffix: true,
                })}
              </time>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-foreground/90">
          {retrospective.body}
        </p>
      </CardContent>
    </Card>
  );
}

function ParticipantCard({
  participant,
}: {
  participant: WikiParticipant;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-card/30 px-3 py-2.5 transition-colors hover:bg-card/60 hover:border-border/70">
      <AgentAvatar
        name={participant.agentName}
        role={participant.agentRole}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-none">
          {participant.agentName}
        </div>
        <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
          {participant.roleLabel}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
        {participant.proposalCount > 0 ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
            {participant.proposalCount} proposals
          </Badge>
        ) : null}
        {participant.objectionCount > 0 ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
            {participant.objectionCount} objections
          </Badge>
        ) : null}
        {participant.evidenceCount > 0 ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.625rem]">
            {participant.evidenceCount} evidence
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function Timeline({
  events,
}: {
  events: WikiResponse['eventTimeline'];
}) {
  // Render a compact, scrollable timeline of the event spine for this project.
  // Each entry shows the seq number, event type, actor, time, and a short summary.
  return (
    <div className="max-h-96 overflow-y-auto scrollbar-sleek rounded-md border border-border/40 bg-card/20 p-2">
      <ol className="flex flex-col gap-1">
        {events.map((e) => (
          <li
            key={e.seq}
            className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-accent/40"
          >
            <span className="font-mono text-muted-foreground/70 w-10 shrink-0 text-right">
              #{e.seq}
            </span>
            <span className="font-mono text-[var(--status-believed)] w-40 shrink-0 truncate">
              {e.type}
            </span>
            <span className="text-foreground/80 flex-1 truncate" title={e.summary}>
              {e.summary}
            </span>
            {e.actorAgentName ? (
              <span className="text-muted-foreground shrink-0">
                {e.actorAgentName}
              </span>
            ) : (
              <span className="text-muted-foreground/60 shrink-0">
                {e.actorType}
              </span>
            )}
            <time className="text-muted-foreground/70 shrink-0" title={e.createdAt}>
              {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-2 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <Badge
          variant="secondary"
          className="px-1.5 py-0 text-[0.625rem] font-mono"
        >
          {count}
        </Badge>
        {subtitle ? (
          <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
