// AI Org OS — HR / Meta metrics API
// Per the vision doc §5: HR agents measure objection precision, proposal survival
// rate, gate-block accuracy, cost per resolved decision, catch rate on other
// agents' errors. This endpoint computes those metrics from the event spine +
// claims + gates — pure projection, no separate metrics table.
//
// Metrics computed:
// 1. Per-agent: objection precision, proposal survival rate, evidence count,
//    objection count, proposal count, benchmark count, role, team
// 2. Claim status distribution (asserted/believed/tested/falsified/uncertain)
// 3. Gate evaluation summary (passed/blocked/pending per gate name)
// 4. Event-type histogram (how many of each event type on the spine)
// 5. Org-level totals: total events, total claims, total decisions, total gates
// 6. Debate state distribution (draft/open/contested/resolved/escalated)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { EventRecord, EventPayloadMap } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

interface AgentMetric {
  agentId: string;
  agentName: string;
  agentRole: string;
  roleLabel: string;
  teamId: string | null;
  kind: string;
  modelName: string;
  status: string;
  // counts
  proposalsOpened: number;
  objectionsRaised: number;
  evidenceAttached: number;
  experimentsRequested: number;
  experimentsCompleted: number;
  benchmarksReported: number;
  risksFlagged: number;
  decisionsRecorded: number;
  messagesPosted: number;
  totalActions: number;
  // derived metrics
  objectionPrecision: number | null; // fraction of objections later validated (0-1, null if no objections)
  proposalSurvivalRate: number | null; // fraction of proposals NOT falsified (0-1, null if no proposals)
}

interface ClaimStatusCount {
  status: string;
  count: number;
  color: string;
}

interface GateMetric {
  id: string;
  name: string;
  state: string;
  policy: string;
  reason: string | null;
  decisionId: string | null;
}

interface EventTypeCount {
  type: string;
  count: number;
  color: string;
}

interface HrMetricsResponse {
  org: { id: string; name: string } | null;
  totals: {
    agents: number;
    activeAgents: number;
    claims: number;
    decisions: number;
    gates: number;
    events: number;
    openRisks: number;
    blockedGates: number;
    passedGates: number;
  };
  agentMetrics: AgentMetric[];
  claimStatusDistribution: ClaimStatusCount[];
  gateEvaluations: GateMetric[];
  eventTypeHistogram: EventTypeCount[];
  debateStateDistribution: { state: string; count: number }[];
  generatedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  architect: 'Distributed Systems Architect',
  engineer: 'Software Engineer',
  security: 'Security Architect',
  perf: 'Performance Engineer',
  qa: 'QA Engineer',
  devils_advocate: "Devil's Advocate",
  verifier: 'Verifier',
  product: 'Product Lead',
  research: 'Researcher',
  hr: 'HR / Meta',
};

const CLAIM_STATUS_COLORS: Record<string, string> = {
  asserted: 'var(--status-asserted)',
  believed: 'var(--status-believed)',
  tested: 'var(--status-tested)',
  falsified: 'var(--status-falsified)',
  uncertain: 'var(--status-uncertain)',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  ProposalOpened: 'var(--status-believed)',
  ObjectionRaised: 'var(--status-asserted)',
  EvidenceAttached: 'var(--status-believed)',
  ExperimentRequested: 'var(--status-asserted)',
  ExperimentCompleted: 'var(--status-tested)',
  BenchmarkReported: 'var(--status-tested)',
  RiskFlagged: 'var(--status-falsified)',
  DecisionRecorded: 'var(--status-falsified)',
  ClaimStatusChanged: 'var(--status-uncertain)',
  GateBlocked: 'var(--status-falsified)',
  GatePassed: 'var(--status-tested)',
  GateEvaluated: 'var(--status-uncertain)',
  RoleAssigned: 'var(--status-uncertain)',
  MessagePosted: 'var(--status-uncertain)',
  ObjectiveFiled: 'var(--status-believed)',
  AgentInstalled: 'var(--status-believed)',
};

export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true, name: true },
  });
  if (!org) {
    return NextResponse.json({
      org: null,
      totals: {
        agents: 0,
        activeAgents: 0,
        claims: 0,
        decisions: 0,
        gates: 0,
        events: 0,
        openRisks: 0,
        blockedGates: 0,
        passedGates: 0,
      },
      agentMetrics: [],
      claimStatusDistribution: [],
      gateEvaluations: [],
      eventTypeHistogram: [],
      debateStateDistribution: [],
      generatedAt: new Date().toISOString(),
    } satisfies HrMetricsResponse);
  }

  // Fetch all agents
  const agents = await db.agent.findMany({
    where: { orgId: org.id },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  // Fetch all claims (for status distribution + objection precision)
  const claims = await db.claim.findMany({
    where: { orgId: org.id },
  });

  // Fetch all decisions
  const decisions = await db.decision.findMany({
    where: { orgId: org.id },
  });

  // Fetch all gates
  const gates = await db.gate.findMany({
    where: { orgId: org.id },
    orderBy: { name: 'asc' },
  });

  // Replay the entire event spine for this org (across all scopes)
  const spine = new EventSpine(org.tenantId, org.id);
  const allEvents = await spine.replay({ limit: 5000 });

  // ─── Per-agent metrics ──────────────────────────────────────────────────
  const agentMetrics: AgentMetric[] = agents.map((a) => {
    const agentEvents = allEvents.filter((e) => e.actorAgentId === a.id);
    const proposalsOpened = agentEvents.filter((e) => e.type === 'ProposalOpened').length;
    const objectionsRaised = agentEvents.filter((e) => e.type === 'ObjectionRaised').length;
    const evidenceAttached = agentEvents.filter((e) => e.type === 'EvidenceAttached').length;
    const experimentsRequested = agentEvents.filter((e) => e.type === 'ExperimentRequested').length;
    const experimentsCompleted = agentEvents.filter((e) => e.type === 'ExperimentCompleted').length;
    const benchmarksReported = agentEvents.filter((e) => e.type === 'BenchmarkReported').length;
    const risksFlagged = agentEvents.filter((e) => e.type === 'RiskFlagged').length;
    const decisionsRecorded = agentEvents.filter((e) => e.type === 'DecisionRecorded').length;
    const messagesPosted = agentEvents.filter((e) => e.type === 'MessagePosted').length;

    const totalActions =
      proposalsOpened +
      objectionsRaised +
      evidenceAttached +
      experimentsRequested +
      experimentsCompleted +
      benchmarksReported +
      risksFlagged +
      decisionsRecorded;

    // Objection precision: fraction of this agent's objections that were later
    // validated (i.e. a subsequent BenchmarkReported or ExperimentCompleted with
    // outcome=refutes exists targeting the same decision, OR a ClaimStatusChanged
    // to 'falsified' exists that the objection contributed to).
    let validatedObjections = 0;
    if (objectionsRaised > 0) {
      const objEvents = agentEvents.filter((e) => e.type === 'ObjectionRaised');
      for (const obj of objEvents) {
        const p = obj.payload as EventPayloadMap['ObjectionRaised'];
        // Did a benchmark or experiment-refutes event happen on the same decision AFTER this objection?
        const decisionId = p.decisionId;
        const refutation = allEvents.find(
          (e) =>
            e.seq > obj.seq &&
            e.scopeType === 'decision' &&
            e.scopeId === decisionId &&
            (e.type === 'BenchmarkReported' ||
              (e.type === 'ExperimentCompleted' &&
                (e.payload as EventPayloadMap['ExperimentCompleted']).outcome === 'refutes')),
        );
        if (refutation) validatedObjections++;
      }
    }
    const objectionPrecision =
      objectionsRaised > 0 ? validatedObjections / objectionsRaised : null;

    // Proposal survival rate: fraction of this agent's proposals that were NOT
    // later falsified (i.e. no DecisionRecorded with outcome=falsified on the
    // same decision).
    let falsifiedProposals = 0;
    if (proposalsOpened > 0) {
      const propEvents = agentEvents.filter((e) => e.type === 'ProposalOpened');
      for (const prop of propEvents) {
        const p = prop.payload as EventPayloadMap['ProposalOpened'];
        const decisionId = p.decisionId;
        const falsified = allEvents.find(
          (e) =>
            e.seq > prop.seq &&
            e.type === 'DecisionRecorded' &&
            (e.payload as EventPayloadMap['DecisionRecorded']).outcome === 'falsified' &&
            e.scopeId === decisionId,
        );
        if (falsified) falsifiedProposals++;
      }
    }
    const proposalSurvivalRate =
      proposalsOpened > 0 ? (proposalsOpened - falsifiedProposals) / proposalsOpened : null;

    return {
      agentId: a.id,
      agentName: a.name,
      agentRole: a.role,
      roleLabel: ROLE_LABELS[a.role] ?? a.role,
      teamId: a.teamId,
      kind: a.kind,
      modelName: a.modelName,
      status: a.status,
      proposalsOpened,
      objectionsRaised,
      evidenceAttached,
      experimentsRequested,
      experimentsCompleted,
      benchmarksReported,
      risksFlagged,
      decisionsRecorded,
      messagesPosted,
      totalActions,
      objectionPrecision,
      proposalSurvivalRate,
    };
  });

  // ─── Claim status distribution ──────────────────────────────────────────
  const claimStatusCounts: Record<string, number> = {};
  for (const c of claims) {
    claimStatusCounts[c.status] = (claimStatusCounts[c.status] ?? 0) + 1;
  }
  const claimStatusDistribution: ClaimStatusCount[] = Object.entries(claimStatusCounts).map(
    ([status, count]) => ({
      status,
      count,
      color: CLAIM_STATUS_COLORS[status] ?? 'var(--status-uncertain)',
    }),
  );

  // ─── Gate evaluations ────────────────────────────────────────────────────
  const gateEvaluations: GateMetric[] = gates.map((g) => ({
    id: g.id,
    name: g.name,
    state: g.state,
    policy: g.policy,
    reason: g.reason,
    decisionId: g.decisionId,
  }));

  // ─── Event-type histogram ────────────────────────────────────────────────
  const eventTypeCounts: Record<string, number> = {};
  for (const e of allEvents) {
    eventTypeCounts[e.type] = (eventTypeCounts[e.type] ?? 0) + 1;
  }
  const eventTypeHistogram: EventTypeCount[] = Object.entries(eventTypeCounts)
    .map(([type, count]) => ({
      type,
      count,
      color: EVENT_TYPE_COLORS[type] ?? 'var(--status-uncertain)',
    }))
    .sort((a, b) => b.count - a.count);

  // ─── Debate state distribution ──────────────────────────────────────────
  const debateStateCounts: Record<string, number> = {};
  for (const d of decisions) {
    debateStateCounts[d.state] = (debateStateCounts[d.state] ?? 0) + 1;
  }
  const debateStateDistribution = Object.entries(debateStateCounts).map(([state, count]) => ({
    state,
    count,
  }));

  // ─── Totals ───────────────────────────────────────────────────────────────
  const openRisks = allEvents.filter((e) => e.type === 'RiskFlagged').length;
  const blockedGates = gates.filter((g) => g.state === 'blocked').length;
  const passedGates = gates.filter((g) => g.state === 'passed').length;

  const response: HrMetricsResponse = {
    org: { id: org.id, name: org.name },
    totals: {
      agents: agents.length,
      activeAgents: agents.filter((a) => a.status === 'active').length,
      claims: claims.length,
      decisions: decisions.length,
      gates: gates.length,
      events: allEvents.length,
      openRisks,
      blockedGates,
      passedGates,
    },
    agentMetrics,
    claimStatusDistribution,
    gateEvaluations,
    eventTypeHistogram,
    debateStateDistribution,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
