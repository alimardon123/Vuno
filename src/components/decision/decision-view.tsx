// Vuno — Decision view (GitHub-PR-style)
// Per SCREENS.md §3. Left column = proposal text + rejected alternatives + open risks.
// Right column = status checks (gates) + participants.
// Bottom = anchored discussion (events scoped to this decision).

'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { StatusPill } from '@/components/common/status-pill';
import { AgentAvatar } from '@/components/common/agent-avatar';
import { StatusChecks } from '@/components/decision/status-checks';
import { AnchoredDiscussion } from '@/components/decision/anchored-discussion';
import { TimelineScrubber } from '@/components/decision/timeline-scrubber';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  GitPullRequest,
  ShieldQuestion,
  Users,
  AlertTriangle,
  ListChecks,
} from 'lucide-react';
import type { EventPayloadMap, EventRecord } from '@/lib/events/types';
import { formatDistanceToNow } from 'date-fns';
import { ROLE_LABELS } from '@/lib/agents/types';

interface AgentsResponse {
  agents: {
    id: string;
    name: string;
    role: string;
    kind: string;
    teamId: string | null;
    status: string;
  }[];
}

interface DecisionResponse {
  decision:
    | {
        id: string;
        title: string;
        state: string;
        outcome: string | null;
        proposerAgentId: string | null;
        createdAt: string;
      }
    | null;
  project:
    | { id: string; name: string; slug: string; description: string | null }
    | null;
  events: EventRecord[];
  projectEvents: EventRecord[];
  gates: {
    id: string;
    name: string;
    state: string;
    policy: string;
    reason: string | null;
  }[];
}

export function DecisionView() {
  const { activeDecisionId, setView, setActiveChannel } = useAppStore();

  const decisionRes = useFetch<DecisionResponse>(
    activeDecisionId ? `/api/decisions/${activeDecisionId}` : null,
  );
  const agentsRes = useFetch<AgentsResponse>('/api/agents');

  const decision = decisionRes.data?.decision ?? null;
  const project = decisionRes.data?.project ?? null;
  const events = decisionRes.data?.events ?? [];
  const projectEvents = decisionRes.data?.projectEvents ?? [];
  const gates = decisionRes.data?.gates ?? [];

  // Extract the ProposalOpened event for the left column body.
  const proposalEvent = useMemo(
    () => events.find((e) => e.type === 'ProposalOpened') ?? null,
    [events],
  );
  const proposalPayload = proposalEvent
    ? (proposalEvent.payload as EventPayloadMap['ProposalOpened'])
    : null;

  // DecisionRecorded event for the rejected alternatives block.
  const decisionRecorded = useMemo(
    () => events.find((e) => e.type === 'DecisionRecorded') ?? null,
    [events],
  );
  const decisionPayload = decisionRecorded
    ? (decisionRecorded.payload as EventPayloadMap['DecisionRecorded'])
    : null;

  // RoleAssigned events for the participants list
  const roleAssigned = useMemo(
    () => events.filter((e) => e.type === 'RoleAssigned'),
    [events],
  );

  // RiskFlagged events for the open risks block — these come from project-scoped events
  // (per the seed: RiskFlagged is project-scoped, not decision-scoped).
  const risks = useMemo(
    () => projectEvents.filter((e) => e.type === 'RiskFlagged'),
    [projectEvents],
  );

  if (!activeDecisionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-base font-medium">No decision selected</span>
        <p className="text-sm text-muted-foreground">
          Open a typed message (ProposalOpened, BenchmarkReported, etc.) from
          the chat to view its decision page.
        </p>
        <Button variant="outline" size="sm" onClick={() => setView('chat')}>
          <ArrowLeft className="size-3.5" aria-hidden /> Back to chat
        </Button>
      </div>
    );
  }

  if (decisionRes.loading) {
    return (
      <div className="p-4">
        <Skeleton className="h-10 w-1/2" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-base font-medium">Decision not found</span>
        <p className="text-sm text-muted-foreground">
          The decision <code className="font-mono">{activeDecisionId}</code>{' '}
          does not exist in this org.
        </p>
        <Button variant="outline" size="sm" onClick={() => setView('chat')}>
          <ArrowLeft className="size-3.5" aria-hidden /> Back to chat
        </Button>
      </div>
    );
  }

  // State pill: blocked = falsified-style, contested = asserted-style, resolved+accepted = tested
  const statePillStatus =
    decision.outcome === 'falsified'
      ? 'falsified'
      : decision.outcome === 'rejected'
        ? 'falsified'
        : decision.outcome === 'accepted'
          ? 'tested'
          : decision.state === 'contested'
            ? 'asserted'
            : 'uncertain';

  // Agents map
  const agents = agentsRes.data?.agents ?? [];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setView('chat')}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </Button>
          <GitPullRequest className="size-4 text-muted-foreground" aria-hidden />
          <h1 className="text-base font-semibold leading-none">
            {decision.title}
          </h1>
          <StatusPill status={statePillStatus} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Decision <span className="font-mono">{decision.id}</span>
          {decision.proposerAgentId
            ? ` · opened by ${agentById.get(decision.proposerAgentId)?.name ?? 'an agent'}`
            : ''}
          {` · ${formatDistanceToNow(new Date(decision.createdAt), { addSuffix: true })}`}
          {project ? ` · project: ${project.name}` : ''}
        </p>
      </header>

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-4 p-4">
          {/* Top: 2-column layout */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Left column: proposal + rejected alternatives + risks */}
            <div className="flex flex-col gap-3">
              <Card className="gap-3 py-4">
                <CardHeader className="pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ListChecks className="size-3.5 opacity-70" aria-hidden />
                    Proposal
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-relaxed">
                  {proposalPayload ? (
                    <>
                      <div className="mb-2 font-medium">
                        {proposalPayload.title}
                      </div>
                      <p>{proposalPayload.body}</p>
                      {project ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          scope:{' '}
                          <span className="font-mono">{project.slug}</span>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No ProposalOpened event on this decision.
                    </span>
                  )}
                </CardContent>
              </Card>

              {/* Rejected alternatives — from DecisionRecorded.rejectedAlternatives OR ProposalOpened.alternatives */}
              <Card className="gap-3 py-4">
                <CardHeader className="pb-1.5">
                  <CardTitle className="text-sm">
                    Rejected alternatives
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-relaxed">
                  {(() => {
                    const alts = decisionPayload?.rejectedAlternatives ??
                      proposalPayload?.alternatives?.map((a) => ({
                        name: a.name,
                        reason: a.rejectedReason,
                      })) ??
                      [];
                    if (alts.length === 0) {
                      return (
                        <span className="text-muted-foreground">(none)</span>
                      );
                    }
                    return (
                      <ul className="flex flex-col gap-1.5">
                        {alts.map((a, i) => (
                          <li
                            key={i}
                            className="flex flex-col gap-0.5 border-l-2 border-muted pl-2"
                          >
                            <span className="font-medium">{a.name}</span>
                            <span className="text-xs text-muted-foreground">
                              rejected: {a.reason}
                            </span>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Open risks */}
              <Card className="gap-3 py-4">
                <CardHeader className="pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <AlertTriangle
                      className="size-3.5 opacity-70"
                      aria-hidden
                    />
                    Open risks
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-relaxed">
                  {risks.length === 0 ? (
                    <span className="text-muted-foreground">(none)</span>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {risks.map((r) => {
                        const p = r.payload as EventPayloadMap['RiskFlagged'];
                        return (
                          <li
                            key={r.id}
                            className="flex flex-col gap-0.5 border-l-2 pl-2"
                            style={{
                              borderColor:
                                p.severity === 'high' ||
                                p.severity === 'critical'
                                  ? 'var(--status-falsified)'
                                  : 'var(--status-asserted)',
                            }}
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                                severity:
                              </span>
                              <span className="font-mono text-xs">
                                {p.severity}
                              </span>
                            </div>
                            <span>{p.description}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right column: status checks + participants */}
            <div className="flex flex-col gap-3">
              <StatusChecks gates={gates} />

              <Card className="gap-3 py-4">
                <CardHeader className="pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Users className="size-3.5 opacity-70" aria-hidden />
                    Participants
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  {roleAssigned.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                      (no participants)
                    </span>
                  ) : (
                    roleAssigned.map((e) => {
                      const p = e.payload as EventPayloadMap['RoleAssigned'];
                      const a = agentById.get(p.agentId);
                      return (
                        <div
                          key={e.id}
                          className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"
                        >
                          <AgentAvatar
                            name={p.agentName}
                            role={a?.role}
                            size="sm"
                            health={a?.status === 'active' ? 'ok' : 'warn'}
                          />
                          <span className="truncate">{p.agentName}</span>
                          <span className="ml-auto text-[0.625rem] text-muted-foreground">
                            {ROLE_LABELS[p.role] ?? p.role}
                          </span>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card className="gap-3 py-4">
                <CardHeader className="pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ShieldQuestion className="size-3.5 opacity-70" aria-hidden />
                    Decision state
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">state</span>
                    <StatusPill status={statePillStatus} label={decision.state} />
                  </div>
                  {decision.outcome ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">outcome</span>
                      <span className="font-mono text-xs">
                        {decision.outcome}
                      </span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Bottom: timeline scrubber (time-travel) */}
          <TimelineScrubber events={events} />

          {/* Bottom: anchored discussion */}
          <Card className="gap-2 py-4">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">
                Discussion (anchored to proposal sections)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <AnchoredDiscussion
                events={events}
                loading={decisionRes.loading}
              />
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      {/* Footer: back to channel */}
      <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => {
            setActiveChannel('ch-storage');
            setView('chat');
          }}
        >
          <ArrowLeft className="size-3" aria-hidden /> Back to #storage-engine
        </Button>
      </footer>
    </div>
  );
}
