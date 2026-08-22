// AI Org OS — Project Wiki API
// Per ADR-0005: the wiki is GENERATED from the ledger, not maintained beside it.
// Pure projection — no separate WikiPage table. Always current; never drifts.
//
// Returns the assembled wiki for the first project (v1 = single seeded project).
// Sections: overview, decisions (with anatomy), claims (grouped by status),
// open risks, unresolved uncertainties, organizational retrospective (HR),
// participants, and an event timeline summary.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { EventRecord, EventPayloadMap } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

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

function eventSummary(e: EventRecord): string {
  const p = e.payload as Record<string, unknown> & { body?: string; title?: string; claimText?: string; description?: string };
  if (typeof p.body === 'string' && p.body.length > 0) return p.body.slice(0, 120);
  if (typeof p.title === 'string') return p.title;
  if (typeof p.claimText === 'string') return p.claimText.slice(0, 120);
  if (typeof p.description === 'string') return p.description.slice(0, 120);
  return e.type;
}

export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) {
    return NextResponse.json({
      project: null,
      objective: null,
      decisions: [],
      claimsByStatus: {},
      claimsTotal: 0,
      openRisks: [],
      unresolvedUncertainties: [],
      retrospective: [],
      participants: [],
      eventTimeline: [],
      generatedAt: new Date().toISOString(),
      lastEventAt: null,
      totalEventCount: 0,
    } satisfies WikiResponse);
  }

  // First project (v1 = single seeded project)
  const project = await db.project.findFirst({
    where: { orgId: org.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!project) {
    return NextResponse.json({
      project: null,
      objective: null,
      decisions: [],
      claimsByStatus: {},
      claimsTotal: 0,
      openRisks: [],
      unresolvedUncertainties: [],
      retrospective: [],
      participants: [],
      eventTimeline: [],
      generatedAt: new Date().toISOString(),
      lastEventAt: null,
      totalEventCount: 0,
    } satisfies WikiResponse);
  }

  // Objective (if linked)
  const objective = project.objectiveId
    ? await db.objective.findUnique({ where: { id: project.objectiveId } })
    : null;

  // All decisions for this project
  const decisions = await db.decision.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'asc' },
  });

  // All gates for this project
  const gates = await db.gate.findMany({
    where: { projectId: project.id }, // include all gates regardless of decisionId
    orderBy: { name: 'asc' },
  });

  // All claims scoped to this project
  const claims = await db.claim.findMany({
    where: { scopeType: 'project', scopeId: project.id },
    orderBy: { updatedAt: 'desc' },
  });

  // Agents map for resolving names/roles
  const agents = await db.agent.findMany({
    where: { orgId: org.id },
    select: { id: true, name: true, role: true },
  });
  const agentById = new Map(agents.map((a) => [a.id, a]));
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

  // Event spine for project-scoped + decision-scoped events (for retrospective,
  // evidence counts, timeline). Replay from seq=0.
  const spine = new EventSpine(org.tenantId, org.id);

  // Pull all events for the project + all its decisions
  const decisionIds = decisions.map((d) => d.id);
  const projectEvents = await spine.replay({
    scopeType: 'project',
    scopeId: project.id,
    limit: 1000,
  });

  const decisionEvents: EventRecord[] = [];
  for (const did of decisionIds) {
    const evs = await spine.replay({
      scopeType: 'decision',
      scopeId: did,
      limit: 1000,
    });
    decisionEvents.push(...evs);
  }

  // Also pull the channel events to find HR retrospective messages (which
  // live in the channel scope, not project scope). We'll filter for the HR
  // agent's MessagePosted events that mention retrospective-style content.
  const channels = await db.channel.findMany({
    where: { orgId: org.id },
    select: { id: true },
  });
  const channelEvents: EventRecord[] = [];
  for (const c of channels) {
    const evs = await spine.replay({
      scopeType: 'channel',
      scopeId: c.id,
      limit: 1000,
    });
    channelEvents.push(...evs);
  }

  // ─── Build decisions array ──────────────────────────────────────────────
  const wikiDecisions: WikiDecision[] = decisions.map((d) => {
    const dEvents = decisionEvents.filter((e) => e.scopeId === d.id);
    const proposalEvent = dEvents.find((e) => e.type === 'ProposalOpened');
    const proposalPayload = proposalEvent
      ? (proposalEvent.payload as EventPayloadMap['ProposalOpened'])
      : null;
    const decisionRecorded = dEvents.find((e) => e.type === 'DecisionRecorded');
    const decisionPayload = decisionRecorded
      ? (decisionRecorded.payload as EventPayloadMap['DecisionRecorded'])
      : null;
    const roleAssigned = dEvents.filter((e) => e.type === 'RoleAssigned');
    const proposer = agents.find((a) => a.id === d.proposerAgentId);
    const decisionGates = gates.filter((g) => g.decisionId === d.id);

    return {
      id: d.id,
      title: d.title,
      state: d.state,
      outcome: d.outcome,
      proposerAgentName: proposer?.name ?? null,
      proposerAgentRole: proposer?.role ?? null,
      createdAt: d.createdAt.toISOString(),
      proposalBody: proposalPayload?.body ?? null,
      alternatives: proposalPayload?.alternatives ?? null,
      rejectedAlternatives: decisionPayload?.rejectedAlternatives ?? null,
      rationale: decisionPayload?.rationale ?? null,
      participants: roleAssigned.map((e) => {
        const p = e.payload as EventPayloadMap['RoleAssigned'];
        return {
          agentId: p.agentId,
          agentName: p.agentName,
          role: p.role,
          roleLabel: ROLE_LABELS[p.role] ?? p.role,
        };
      }),
      evidenceCount: dEvents.filter((e) => e.type === 'EvidenceAttached').length,
      objectionCount: dEvents.filter((e) => e.type === 'ObjectionRaised').length,
      experimentCount: dEvents.filter((e) => e.type === 'ExperimentRequested').length,
      benchmarkCount: dEvents.filter((e) => e.type === 'BenchmarkReported').length,
      statusChecks: decisionGates.map((g) => ({
        id: g.id,
        name: g.name,
        state: g.state,
        policy: g.policy,
        reason: g.reason,
      })),
    };
  });

  // ─── Group claims by status ──────────────────────────────────────────────
  const claimsByStatus: Record<string, WikiClaim[]> = {
    asserted: [],
    believed: [],
    tested: [],
    falsified: [],
    uncertain: [],
  };
  for (const c of claims) {
    const evidenceIds = JSON.parse(c.evidenceIds) as string[];
    const contradictsIds = JSON.parse(c.contradictsIds) as string[];
    const agent = c.provenanceAgentId ? agentById.get(c.provenanceAgentId) : null;
    const wikiClaim: WikiClaim = {
      id: c.id,
      statement: c.statement,
      status: c.status,
      scopeType: c.scopeType,
      scopeId: c.scopeId,
      provenanceAgentId: c.provenanceAgentId,
      provenanceAgentName: agent?.name ?? null,
      provenanceAgentRole: agent?.role ?? null,
      evidenceCount: evidenceIds.length,
      contradictsCount: contradictsIds.length,
      statusReason: c.statusReason,
      updatedAt: c.updatedAt.toISOString(),
    };
    if (claimsByStatus[c.status]) {
      claimsByStatus[c.status].push(wikiClaim);
    } else {
      (claimsByStatus[c.status] as WikiClaim[]) = [wikiClaim];
    }
  }

  // ─── Open risks (from project-scoped RiskFlagged events) ────────────────
  const riskEvents = projectEvents.filter((e) => e.type === 'RiskFlagged');
  const wikiRisks: WikiRisk[] = riskEvents.map((e) => {
    const p = e.payload as EventPayloadMap['RiskFlagged'];
    const agent = e.actorAgentId ? agentById.get(e.actorAgentId) : null;
    return {
      id: e.id,
      severity: p.severity,
      description: p.description,
      flaggedByAgentName: agent?.name ?? null,
      flaggedAt: e.createdAt,
      claimId: p.claimId ?? null,
    };
  });

  // ─── Unresolved uncertainties = claims with status=uncertain ─────────────
  const unresolvedUncertainties = claimsByStatus.uncertain;

  // ─── Retrospective: HR agent's MessagePosted events ──────────────────────
  // Look for messages from the HR agent that contain retrospective keywords.
  // Also include any HR-scoped event (agentId is the HR agent).
  const hrAgent = agents.find((a) => a.role === 'hr');
  const retrospective: WikiRetrospective[] = [];
  if (hrAgent) {
    for (const e of channelEvents) {
      if (e.type !== 'MessagePosted') continue;
      if (e.actorAgentId !== hrAgent.id) continue;
      const p = e.payload as EventPayloadMap['MessagePosted'];
      // Heuristic: HR retrospective messages mention objection precision, survival rate,
      // metrics, retrospective, or similar.
      const keywords = [
        'objection precision',
        'survival',
        'retrospective',
        'meta log',
        'metrics',
        'org is working',
      ];
      const body = p.body.toLowerCase();
      if (keywords.some((k) => body.includes(k))) {
        retrospective.push({
          agentName: hrAgent.name,
          agentRole: hrAgent.role,
          body: p.body,
          postedAt: e.createdAt,
        });
      }
    }
  }

  // ─── Participants (agents who participated in any decision) ─────────────
  const participantMap = new Map<string, WikiParticipant>();
  for (const e of decisionEvents) {
    if (!e.actorAgentId) continue;
    const agent = agentById.get(e.actorAgentId);
    if (!agent) continue;
    const p = participantMap.get(agent.id) ?? {
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      roleLabel: ROLE_LABELS[agent.role] ?? agent.role,
      proposalCount: 0,
      objectionCount: 0,
      evidenceCount: 0,
    };
    if (e.type === 'ProposalOpened') p.proposalCount++;
    if (e.type === 'ObjectionRaised') p.objectionCount++;
    if (e.type === 'EvidenceAttached') p.evidenceCount++;
    participantMap.set(agent.id, p);
  }

  // ─── Timeline (all events for this project, sorted by seq) ───────────────
  const allEvents = [...projectEvents, ...decisionEvents].sort(
    (a, b) => a.seq - b.seq,
  );
  const eventTimeline = allEvents.map((e) => {
    const agent = e.actorAgentId ? agentById.get(e.actorAgentId) : null;
    return {
      seq: e.seq,
      type: e.type,
      actorType: e.actorType,
      actorAgentName: agent?.name ?? null,
      createdAt: e.createdAt,
      summary: eventSummary(e),
    };
  });

  // Last event time
  const lastEvent = allEvents[allEvents.length - 1] ?? null;
  const totalEventCount = allEvents.length;

  const wiki: WikiResponse = {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
    },
    objective: objective
      ? {
          id: objective.id,
          title: objective.title,
          successCriteria: objective.successCriteria,
          constraints: objective.constraints,
          budget: objective.budget,
          autonomyLevel: objective.autonomyLevel,
          status: objective.status,
        }
      : null,
    decisions: wikiDecisions,
    claimsByStatus,
    claimsTotal: claims.length,
    openRisks: wikiRisks,
    unresolvedUncertainties,
    retrospective,
    participants: Array.from(participantMap.values()),
    eventTimeline,
    generatedAt: new Date().toISOString(),
    lastEventAt: lastEvent ? lastEvent.createdAt : null,
    totalEventCount,
  };

  return NextResponse.json(wiki);
}
