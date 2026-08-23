// Vuno — Right context rail
// Varies by active view: chat → channel info, decision → participants & related claims,
// ledger → filter summary, agents → legend.

'use client';

import { useAppStore } from '@/store/app-store';
import { useFetch } from '@/hooks/use-fetch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentAvatar } from '@/components/common/agent-avatar';
import { StatusPill } from '@/components/common/status-pill';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ClaimStatus } from '@/lib/events/types';
import { ROLE_LABELS } from '@/lib/agents/types';
import {
  CircleSlash,
  Filter,
  Info,
  Pin,
  ShieldQuestion,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';

interface Agent {
  id: string;
  name: string;
  role: string;
  teamId: string | null;
  status: string;
  avatarGlyph?: string | null;
}

interface DecisionResponse {
  decision:
    | {
        id: string;
        title: string;
        state: string;
        outcome: string | null;
        proposerAgentId: string | null;
      }
    | null;
  project:
    | { id: string; name: string; slug: string; description: string | null }
    | null;
  events: Array<{
    id: string;
    seq: number;
    type: string;
    payload: unknown;
    actorMemberId?: string | null;
    onBehalfOfMemberId?: string | null;
    actorType: string;
    createdAt: string;
  }>;
  gates: Array<{
    id: string;
    name: string;
    state: string;
    policy: string;
    reason: string | null;
  }>;
}

interface Claim {
  id: string;
  statement: string;
  status: ClaimStatus;
  scopeType: string;
  scopeId: string;
  provenanceMemberId?: string | null;
  evidenceIds: string[];
  contradictsIds: string[];
  statusReason?: string | null;
  updatedAt: string;
}

interface ClaimsResponse {
  claims: Claim[];
}

interface AgentsResponse {
  agents: Agent[];
}

const ROLE_BADGE_LABEL: Record<string, string> = {
  proposer: 'proposer',
  reviewer: 'reviewer',
  devils_advocate: "devil's advocate",
  domain_expert: 'domain expert',
  verifier: 'verifier',
};

export function RightRail({ onClose }: { onClose?: () => void }) {
  const {
    activeView,
    activeChannelId,
    activeDecisionId,
    ledgerFilters,
    resetLedgerFilters,
    setActiveDecision,
    setView,
  } = useAppStore();

  const agentsRes = useFetch<AgentsResponse>('/api/agents');
  const agents = agentsRes.data?.agents ?? [];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const claimsRes = useFetch<ClaimsResponse>(
    activeDecisionId
      ? `/api/claims?scopeType=decision&scopeId=${activeDecisionId}`
      : null,
  );

  const decisionRes = useFetch<DecisionResponse>(
    activeDecisionId ? `/api/decisions/${activeDecisionId}` : null,
  );

  // The pinned decision for a channel — v1: the seeded dec-17 if the channel is storage-engine.
  // We can't easily derive that from the channel alone in v1; so show the channel's first known decision as "pinned".
  const pinnedDecisionId = activeView === 'chat' && activeChannelId ? 'dec-17' : null;
  const pinnedDecisionRes = useFetch<DecisionResponse>(
    pinnedDecisionId ? `/api/decisions/${pinnedDecisionId}` : null,
  );

  return (
    <div className="flex h-full flex-col gap-4 border-l bg-sidebar/60 p-3">
      {onClose ? (
        <div className="mb-1 flex items-center justify-between md:hidden">
          <span className="text-sm font-medium">Context</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close context panel"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 scrollbar-sleek">
        <div className="flex flex-col gap-4">
          {activeView === 'chat' ? (
            <ChatContext
              agentById={agentById}
              agents={agents}
              channelMembers={agents}
              pinnedDecision={
                pinnedDecisionRes.data?.decision
                  ? {
                      id: pinnedDecisionRes.data.decision.id,
                      title: pinnedDecisionRes.data.decision.title,
                    }
                  : null
              }
              onOpenDecision={(id) => {
                setActiveDecision(id);
                onClose?.();
              }}
            />
          ) : null}

          {activeView === 'decision' ? (
            <DecisionContext
              decisionRes={decisionRes}
              agentsRes={agentsRes}
              claimsRes={claimsRes}
              agentById={agentById}
              onOpenClaim={() => {
                setView('ledger');
                onClose?.();
              }}
            />
          ) : null}

          {activeView === 'ledger' ? (
            <LedgerContext
              filters={ledgerFilters}
              onReset={resetLedgerFilters}
            />
          ) : null}

          {activeView === 'agents' ? <AgentsContext /> : null}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Chat context ─────────────────────────────────────────────────────────
function ChatContext({
  agentById,
  agents,
  pinnedDecision,
  onOpenDecision,
}: {
  agentById: Map<string, Agent>;
  agents: Agent[];
  channelMembers: Agent[];
  pinnedDecision: { id: string; title: string } | null;
  onOpenDecision: (id: string) => void;
}) {
  return (
    <>
      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Info className="size-3.5 opacity-70" aria-hidden />
            Channel
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            This channel is a projection of the event spine. Every message is
            a typed event appended immutably.
          </p>
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Pin className="size-3.5 opacity-70" aria-hidden />
            Pinned decision
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {pinnedDecision ? (
            <button
              type="button"
              onClick={() => onOpenDecision(pinnedDecision.id)}
              className="rounded-md border bg-card p-2 text-left transition-colors hover:bg-accent"
            >
              <div className="text-[0.625rem] text-muted-foreground uppercase tracking-wider">
                Decision
              </div>
              <div className="font-medium leading-snug">
                {pinnedDecision.title}
              </div>
              <div className="mt-1 text-xs text-primary">Open decision →</div>
            </button>
          ) : (
            <p className="text-muted-foreground">No pinned decision.</p>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">
            Members{' '}
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[0.625rem]">
              {agents.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members.</p>
          ) : (
            agents.slice(0, 6).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-md px-1 py-1"
              >
                <AgentAvatar
                  name={a.name}
                  role={a.role}
                  size="sm"
                  health={a.status === 'active' ? 'ok' : 'warn'}
                />
                <span className="truncate text-sm">{a.name}</span>
                <span className="ml-auto text-[0.625rem] text-muted-foreground">
                  {ROLE_LABELS[a.role] ?? a.role}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      {/* Hint the agentById is used elsewhere too */}
      <span className="sr-only">{agentById.size} agents loaded</span>
    </>
  );
}

// ─── Decision context ───────────────────────────────────────────────────────
function DecisionContext({
  decisionRes,
  agentsRes,
  claimsRes,
  agentById,
  onOpenClaim,
}: {
  decisionRes: ReturnType<typeof useFetch<DecisionResponse>>;
  agentsRes: ReturnType<typeof useFetch<AgentsResponse>>;
  claimsRes: ReturnType<typeof useFetch<ClaimsResponse>>;
  agentById: Map<string, Agent>;
  onOpenClaim: () => void;
}) {
  if (decisionRes.loading) {
    return <Skeleton className="h-32 w-full" />;
  }
  const decision = decisionRes.data?.decision;
  if (!decision) {
    return (
      <EmptyHint
        icon={<CircleSlash className="size-4" aria-hidden />}
        title="No decision selected"
        body="Open a proposal message in the chat to see its decision context."
      />
    );
  }
  const events = decisionRes.data?.events ?? [];
  const roleAssignedEvents = events.filter((e) => e.type === 'RoleAssigned');

  return (
    <>
      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldQuestion className="size-3.5 opacity-70" aria-hidden />
            Decision
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="font-medium leading-snug">{decision.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            state: <span className="font-mono">{decision.state}</span>
            {decision.outcome
              ? ` · outcome: ${decision.outcome}`
              : ''}
          </div>
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">Participants</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {agentsRes.loading ? (
            <Skeleton className="h-6 w-full" />
          ) : roleAssignedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No participants.</p>
          ) : (
            roleAssignedEvents.map((e) => {
              const p = e.payload as {
                role: string;
                agentId: string;
                agentName: string;
              };
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
                  />
                  <span className="truncate">{p.agentName}</span>
                  <span className="ml-auto text-[0.625rem] text-muted-foreground">
                    {ROLE_BADGE_LABEL[p.role] ?? p.role}
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">Related claims</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {claimsRes.loading ? (
            <Skeleton className="h-12 w-full" />
          ) : (claimsRes.data?.claims ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No claims.</p>
          ) : (
            (claimsRes.data?.claims ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={onOpenClaim}
                className="rounded-md border bg-card p-2 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {c.id.slice(0, 18)}
                  </span>
                  <StatusPill status={c.status as ClaimStatus} />
                </div>
                <div className="mt-1 text-sm leading-snug">{c.statement}</div>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Ledger context ──────────────────────────────────────────────────────────
function LedgerContext({
  filters,
  onReset,
}: {
  filters: { status: ClaimStatus[]; actorId: string | null; scopeId: string | null };
  onReset: () => void;
}) {
  const hasFilters =
    filters.status.length > 0 || filters.actorId || filters.scopeId;
  return (
    <>
      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="size-3.5 opacity-70" aria-hidden />
            Active filters
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {hasFilters ? (
            <>
              <FilterRow
                label="Status"
                value={
                  filters.status.length > 0
                    ? filters.status.join(', ')
                    : 'all'
                }
              />
              <FilterRow
                label="Actor"
                value={filters.actorId ?? 'all'}
              />
              <FilterRow
                label="Project"
                value={filters.scopeId ?? 'all'}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full justify-start"
                onClick={onReset}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              No filters applied. Showing all claims.
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="gap-3 py-4">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">Status legend</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-xs">
          {(
            [
              'asserted',
              'believed',
              'tested',
              'falsified',
              'uncertain',
            ] as ClaimStatus[]
          ).map((s) => (
            <div
              key={s}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-muted-foreground">{s}</span>
              <StatusPill status={s} />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function FilterRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-xs">{value}</span>
    </div>
  );
}

// ─── Agents context ─────────────────────────────────────────────────────────
function AgentsContext() {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Info className="size-3.5 opacity-70" aria-hidden />
          Agent registry
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <p>
          Agents are installed into the org, assigned to a team, and invoked
          through the adapter interface. v1 ships simulated adapters; v2
          drops in real LLM adapters — same interface.
        </p>
        <p className="mt-3 text-xs">
          Roles are separated from models, models from harnesses, harnesses
          from tools. The substrate, ledger, and gates never change between v1
          and v2.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Empty hint ──────────────────────────────────────────────────────────────
function EmptyHint({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
    </Card>
  );
}

// Use date-fns at least once for the typing
export const _relativeTime = (iso: string) =>
  formatDistanceToNow(new Date(iso), { addSuffix: true });
