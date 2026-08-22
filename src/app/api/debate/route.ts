// AI Org OS — /api/debate POST endpoint
// Per ADR-0002 and the live-debate-slice goal: lets the user trigger a new
// simulated debate. The orchestrator runs the AgentAdapter chain in sequence:
//   1. architect.invoke(ProposalRequested) → ProposalOpened + MessagePosted
//   2. role assignments (system) → RoleAssigned × 4
//   3. security.invoke(ProposalOpened) → MessagePosted (security review)
//   4. devils_advocate.invoke(ProposalOpened) → ObjectionRaised + MessagePosted
//   5. perf.invoke(ObjectionRaised) → ExperimentRequested + MessagePosted
//   6. perf.invoke(ExperimentRequested) → ExperimentCompleted + BenchmarkReported + MessagePosted
//   7. system: ClaimStatusChanged (believed → falsified) + RiskFlagged + GateEvaluated (perf blocked) + GateBlocked (release blocked)
//   8. architect.invoke(DecisionRecorded trigger) — actually we craft DecisionRecorded here
//   9. hr.invoke(DecisionRecorded) → MessagePosted (retrospective)
//
// All events appended atomically via the EventSpine. Returns the new decision id
// and the count of events appended.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { NewEventInput, EventRecord, ClaimStatus } from '@/lib/events/types';
import type { AgentContext, AgentAdapter, AgentClaimRecord } from '@/lib/agents/types';
import {
  SimulatedArchitectAdapter,
  SimulatedDevilsAdvocateAdapter,
  SimulatedPerfAdapter,
  SimulatedSecurityAdapter,
  SimulatedVerifierAdapter,
  SimulatedHrAdapter,
} from '@/lib/agents/adapters/simulated';

export const dynamic = 'force-dynamic';

interface DebateRequest {
  title?: string;       // optional: title for the proposal (defaults to a generated one)
  projectId?: string;   // optional: project to scope to (defaults to first project)
  channelId?: string;   // optional: channel to post messages to (defaults to ch-storage)
}

interface DebateResponse {
  ok: boolean;
  decisionId?: string;
  eventsAppended?: number;
  message?: string;
  error?: string;
}

export async function POST(req: Request): Promise<NextResponse<DebateResponse>> {
  try {
    const body = (await req.json().catch(() => ({}))) as DebateRequest;

    const org = await db.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, id: true },
    });
    if (!org) {
      return NextResponse.json({ ok: false, error: 'No organization found. Seed first.' }, { status: 400 });
    }

    // Find the project (default to first)
    const project = body.projectId
      ? await db.project.findUnique({ where: { id: body.projectId } })
      : await db.project.findFirst({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' } });
    if (!project) {
      return NextResponse.json({ ok: false, error: 'No project found.' }, { status: 400 });
    }

    const channelId = body.channelId ?? 'ch-storage';

    // Verify the channel exists
    const channel = await db.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      return NextResponse.json({ ok: false, error: `Channel ${channelId} not found.` }, { status: 400 });
    }

    // Fetch the agents we need (architect, security, devils_advocate, perf, verifier, hr)
    const agents = await db.agent.findMany({
      where: { orgId: org.id, status: 'active' },
    });
    const architect = agents.find((a) => a.role === 'architect');
    const security = agents.find((a) => a.role === 'security');
    const devilsAdvocate = agents.find((a) => a.role === 'devils_advocate');
    const perf = agents.find((a) => a.role === 'perf');
    const verifier = agents.find((a) => a.role === 'verifier');
    const hr = agents.find((a) => a.role === 'hr');

    if (!architect || !security || !devilsAdvocate || !perf || !verifier || !hr) {
      return NextResponse.json(
        { ok: false, error: 'Missing required agents. Need architect, security, devils_advocate, perf, verifier, hr.' },
        { status: 400 },
      );
    }

    // Instantiate adapters
    const adapters: Record<string, AgentAdapter> = {
      [architect.id]: new SimulatedArchitectAdapter(architect.id),
      [security.id]: new SimulatedSecurityAdapter(security.id),
      [devilsAdvocate.id]: new SimulatedDevilsAdvocateAdapter(devilsAdvocate.id),
      [perf.id]: new SimulatedPerfAdapter(perf.id),
      [verifier.id]: new SimulatedVerifierAdapter(verifier.id),
      [hr.id]: new SimulatedHrAdapter(hr.id),
    };

    // Create the Decision row first (so we have the id for events)
    const decisionId = `dec-${Date.now().toString(36)}`;
    await db.decision.create({
      data: {
        id: decisionId,
        tenantId: org.tenantId,
        orgId: org.id,
        projectId: project.id,
        title: body.title ?? 'Architecture: simulated proposal',
        state: 'open',
        proposerAgentId: architect.id,
      },
    });

    // Create gates for this decision (clone from the project's gate templates)
    const gateDefs = [
      { name: 'security', policy: 'no open RiskFlag of severity >= high on this project' },
      { name: 'qa', policy: 'all unit + integration tests pass' },
      { name: 'performance', policy: 'p99 < 50ms at 10k concurrent readers' },
      { name: 'release', policy: 'all upstream gates passed AND no open RiskFlag severity >= high' },
    ];
    const gates: Record<string, { id: string; name: string }> = {};
    for (const g of gateDefs) {
      const row = await db.gate.create({
        data: {
          tenantId: org.tenantId,
          orgId: org.id,
          projectId: project.id,
          decisionId,
          name: g.name,
          policy: g.policy,
          state: 'pending',
        },
      });
      gates[g.name] = { id: row.id, name: g.name };
    }

    // ─── Run the debate chain ───────────────────────────────────────────────
    const spine = new EventSpine(org.tenantId, org.id);
    const allNewEvents: NewEventInput[] = [];
    const allNewClaims: Array<NewClaimInput & { _statusTransition?: { from: ClaimStatus; to: ClaimStatus; reason: string } }> = [];

    // Helper: invoke an adapter and collect its events/claims
    async function runAdapter(
      agentId: string,
      triggerType: string,
      triggerPayload: unknown,
      contextEvents: EventRecord[],
    ): Promise<EventRecord[]> {
      const adapter = adapters[agentId];
      if (!adapter) return [];
      const ctx: AgentContext = {
        events: contextEvents,
        claims: [],
        trigger: { type: triggerType, payload: triggerPayload },
      };
      const response = await adapter.invoke(ctx);
      // Collect events (we'll append them all at once atomically at the end)
      for (const ev of response.events) {
        allNewEvents.push(ev);
      }
      for (const cl of response.claims) {
        allNewClaims.push(cl);
      }
      // Return the new events as EventRecord-like objects for the next adapter's context
      // We need to fake the EventRecord shape (with id, seq, createdAt) so the next
      // adapter can find them by type. We'll use placeholder ids/seqs since the spine
      // will assign real ones on append.
      return response.events.map((ev, i) => ({
        id: `pending-${allNewEvents.length}-${i}`,
        seq: -1 - i, // placeholder; not used for filtering
        type: ev.type,
        payload: ev.payload,
        tenantId: org.tenantId,
        orgId: org.id,
        actorType: ev.actorType,
        actorAgentId: ev.actorAgentId,
        actorUserId: ev.actorUserId,
        scopeType: ev.scopeType,
        scopeId: ev.scopeId,
        visibility: ev.visibility ?? 'org',
        createdAt: new Date().toISOString(),
      })) as EventRecord[];
    }

    // Step 1: Architect proposes
    const proposalTriggerPayload = {
      decisionId,
      projectId: project.id,
      title: body.title ?? 'Architecture: simulated proposal',
    };
    // We need to pass the ProposalOpened event to the next adapters, so we run
    // the architect first and capture its events.
    const architectAdapter = adapters[architect.id]!;
    const architectCtx: AgentContext = {
      events: [],
      claims: [],
      trigger: { type: 'ProposalRequested', payload: proposalTriggerPayload },
    };
    const architectResponse = await architectAdapter.invoke(architectCtx);
    for (const ev of architectResponse.events) allNewEvents.push(ev);
    // Find the ProposalOpened event for downstream context
    const proposalEventRecord: EventRecord = {
      id: 'pending-proposal',
      seq: -1,
      type: 'ProposalOpened',
      payload: architectResponse.events.find((e) => e.type === 'ProposalOpened')!.payload,
      tenantId: org.tenantId,
      orgId: org.id,
      actorType: 'agent',
      actorAgentId: architect.id,
      scopeType: 'decision',
      scopeId: decisionId,
      visibility: 'org',
      createdAt: new Date().toISOString(),
    };

    // Step 2: Role assignments (system events)
    const roleAssignments: Array<{ role: string; agentId: string; agentName: string }> = [
      { role: 'proposer', agentId: architect.id, agentName: architect.name },
      { role: 'reviewer', agentId: security.id, agentName: security.name },
      { role: 'devils_advocate', agentId: devilsAdvocate.id, agentName: devilsAdvocate.name },
      { role: 'verifier', agentId: perf.id, agentName: perf.name },
    ];
    for (const r of roleAssignments) {
      allNewEvents.push({
        type: 'RoleAssigned',
        actorType: 'system',
        scopeType: 'decision',
        scopeId: decisionId,
        payload: {
          decisionId,
          role: r.role as 'reviewer' | 'devils_advocate' | 'domain_expert' | 'verifier' | 'proposer',
          agentId: r.agentId,
          agentName: r.agentName,
        },
      });
    }

    // Step 3: Security reviews the proposal
    await runAdapter(security.id, 'ProposalOpened', proposalEventRecord.payload, [proposalEventRecord]);

    // Step 4: Devil's advocate raises an objection
    const devilsResponse = await adapters[devilsAdvocate.id]!.invoke({
      events: [proposalEventRecord],
      claims: [],
      trigger: { type: 'ProposalOpened', payload: proposalEventRecord.payload },
    });
    for (const ev of devilsResponse.events) allNewEvents.push(ev);
    // Find the ObjectionRaised event
    const objectionEvent = devilsResponse.events.find((e) => e.type === 'ObjectionRaised');
    const objectionEventRecord: EventRecord | null = objectionEvent
      ? {
          id: 'pending-objection',
          seq: -2,
          type: 'ObjectionRaised',
          payload: objectionEvent.payload,
          tenantId: org.tenantId,
          orgId: org.id,
          actorType: 'agent',
          actorAgentId: devilsAdvocate.id,
          scopeType: 'decision',
          scopeId: decisionId,
          visibility: 'org',
          createdAt: new Date().toISOString(),
        }
      : null;

    // Step 5: Perf requests an experiment
    let experimentEventRecord: EventRecord | null = null;
    if (objectionEventRecord) {
      const perfExpResponse = await adapters[perf.id]!.invoke({
        events: [objectionEventRecord],
        claims: [],
        trigger: { type: 'ObjectionRaised', payload: objectionEventRecord.payload },
      });
      for (const ev of perfExpResponse.events) allNewEvents.push(ev);
      const expEvent = perfExpResponse.events.find((e) => e.type === 'ExperimentRequested');
      if (expEvent) {
        experimentEventRecord = {
          id: 'pending-experiment',
          seq: -3,
          type: 'ExperimentRequested',
          payload: expEvent.payload,
          tenantId: org.tenantId,
          orgId: org.id,
          actorType: 'agent',
          actorAgentId: perf.id,
          scopeType: 'decision',
          scopeId: decisionId,
          visibility: 'org',
          createdAt: new Date().toISOString(),
        };
      }
    }

    // Step 6: Perf runs the benchmark
    let benchmarkEventRecord: EventRecord | null = null;
    let benchmarkValue = '0';
    let benchmarkTarget = '50';
    if (experimentEventRecord) {
      const perfBenchResponse = await adapters[perf.id]!.invoke({
        events: [experimentEventRecord],
        claims: [],
        trigger: { type: 'ExperimentRequested', payload: experimentEventRecord.payload },
      });
      for (const ev of perfBenchResponse.events) allNewEvents.push(ev);
      const benchEvent = perfBenchResponse.events.find((e) => e.type === 'BenchmarkReported');
      if (benchEvent) {
        const bp = benchEvent.payload as { value: string; target: string };
        benchmarkValue = bp.value;
        benchmarkTarget = bp.target;
        benchmarkEventRecord = {
          id: 'pending-benchmark',
          seq: -4,
          type: 'BenchmarkReported',
          payload: benchEvent.payload,
          tenantId: org.tenantId,
          orgId: org.id,
          actorType: 'agent',
          actorAgentId: perf.id,
          scopeType: 'decision',
          scopeId: decisionId,
          visibility: 'org',
          createdAt: new Date().toISOString(),
        };
      }
    }

    // Step 7: Verifier confirms
    if (benchmarkEventRecord) {
      await runAdapter(verifier.id, 'BenchmarkReported', benchmarkEventRecord.payload, [benchmarkEventRecord]);
    }

    // Step 8: Create the falsified claim + ClaimStatusChanged + RiskFlagged + GateEvaluated + GateBlocked
    const claimId = `claim-${decisionId}`;
    const claimStatement = `p99 read latency < ${benchmarkTarget}ms at 10k concurrent readers`;
    // We'll create the claim in the DB after the events are appended (need the event id for provenance).
    // For now, queue a ClaimStatusChanged event (system).
    if (benchmarkEventRecord) {
      allNewEvents.push({
        type: 'ClaimStatusChanged',
        actorType: 'system',
        scopeType: 'channel',
        scopeId: channelId,
        payload: {
          claimId,
          from: 'believed' as ClaimStatus,
          to: 'falsified' as ClaimStatus,
          reason: `Benchmark refutes: p99=${benchmarkValue}ms vs target=${benchmarkTarget}ms at 10k concurrent readers.`,
          evidenceEventId: undefined,
        },
      });
      // RiskFlagged (project-scoped)
      allNewEvents.push({
        type: 'RiskFlagged',
        actorType: 'agent',
        actorAgentId: perf.id,
        scopeType: 'project',
        scopeId: project.id,
        payload: {
          scopeType: 'project',
          scopeId: project.id,
          severity: 'high',
          description: `Architecture proposal falsified by benchmark. p99=${benchmarkValue}ms exceeds ${benchmarkTarget}ms target. Working set exceeds RAM under current design.`,
          claimId,
        },
      });
      // GateEvaluated: performance blocked
      allNewEvents.push({
        type: 'GateEvaluated',
        actorType: 'system',
        scopeType: 'project',
        scopeId: project.id,
        payload: {
          gateId: gates.performance.id,
          name: 'performance',
          policy: 'p99 < 50ms at 10k concurrent readers',
          result: 'blocked',
          reason: `p99=${benchmarkValue}ms > ${benchmarkTarget}ms target. Claim ${claimId} falsified.`,
        },
      });
      // GateBlocked: release blocked (cascading)
      allNewEvents.push({
        type: 'GateBlocked',
        actorType: 'system',
        scopeType: 'project',
        scopeId: project.id,
        payload: {
          gateId: gates.release.id,
          name: 'release',
          reason: 'Performance gate blocked AND open high-severity RiskFlag on this project.',
          blockingRiskIds: [claimId],
        },
      });
    }

    // Step 9: Architect records the decision
    const proposalPayload = proposalEventRecord.payload as { title: string; body: string; alternatives?: Array<{ name: string; rejectedReason: string }> };
    const decisionRecordedEvent: NewEventInput<'DecisionRecorded'> = {
      type: 'DecisionRecorded',
      actorType: 'agent',
      actorAgentId: architect.id,
      scopeType: 'decision',
      scopeId: decisionId,
      payload: {
        decisionId,
        outcome: 'falsified',
        chosen: proposalPayload.title,
        rationale: `Architecture proposal falsified by Performance team benchmark. p99 read latency = ${benchmarkValue}ms (target ${benchmarkTarget}ms) at 10k concurrent readers. Working set exceeded RAM. Reopening architecture.`,
        rejectedAlternatives: [
          ...(proposalPayload.alternatives ?? []),
          { name: proposalPayload.title, reason: `Falsified by benchmark — see Claim ${claimId}` },
        ],
      },
    };
    allNewEvents.push(decisionRecordedEvent);

    // Step 10: HR writes a retrospective note
    const decisionRecordedRecord: EventRecord = {
      id: 'pending-decision-recorded',
      seq: -5,
      type: 'DecisionRecorded',
      payload: decisionRecordedEvent.payload,
      tenantId: org.tenantId,
      orgId: org.id,
      actorType: 'agent',
      actorAgentId: architect.id,
      scopeType: 'decision',
      scopeId: decisionId,
      visibility: 'org',
      createdAt: new Date().toISOString(),
    };
    await runAdapter(hr.id, 'DecisionRecorded', decisionRecordedRecord.payload, [decisionRecordedRecord]);

    // ─── Append all events to the spine atomically ──────────────────────────
    const createdEvents = await spine.append(allNewEvents);

    // ─── Create the claim in the DB (now we have the event id for provenance) ──
    const benchmarkDbEvent = createdEvents.find((e) => e.type === 'BenchmarkReported');
    if (benchmarkDbEvent) {
      await db.claim.create({
        data: {
          id: claimId,
          tenantId: org.tenantId,
          orgId: org.id,
          statement: claimStatement,
          status: 'falsified',
          scopeType: 'project',
          scopeId: project.id,
          provenanceEventId: createdEvents.find((e) => e.type === 'ProposalOpened')?.id ?? benchmarkDbEvent.id,
          provenanceActorType: 'agent',
          provenanceAgentId: architect.id,
          evidenceIds: JSON.stringify([benchmarkDbEvent.id]),
          contradictsIds: JSON.stringify([]),
          statusReason: `Falsified by benchmark: p99=${benchmarkValue}ms vs target=${benchmarkTarget}ms at 10k concurrent readers.`,
          updatedAt: new Date(),
        },
      });
    }

    // ─── Update gate states in the DB ────────────────────────────────────────
    if (benchmarkDbEvent) {
      await db.gate.update({
        where: { id: gates.performance.id },
        data: {
          state: 'blocked',
          reason: `p99=${benchmarkValue}ms > ${benchmarkTarget}ms target`,
          evaluatedAt: new Date(),
        },
      });
      await db.gate.update({
        where: { id: gates.release.id },
        data: {
          state: 'blocked',
          reason: 'Performance gate blocked AND open high-severity RiskFlag on this project',
          evaluatedAt: new Date(),
        },
      });
      await db.gate.update({
        where: { id: gates.security.id },
        data: { state: 'passed', reason: 'No open RiskFlag of severity >= high on this project', evaluatedAt: new Date() },
      });
      await db.gate.update({
        where: { id: gates.qa.id },
        data: { state: 'passed', reason: 'All unit + integration tests pass', evaluatedAt: new Date() },
      });
    }

    // Update the decision state
    await db.decision.update({
      where: { id: decisionId },
      data: { state: 'resolved', outcome: 'falsified', updatedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      decisionId,
      eventsAppended: allNewEvents.length,
      message: `Debate completed. ${allNewEvents.length} events appended. Claim ${claimId} falsified. Release gate blocked.`,
    });
  } catch (err) {
    console.error('Debate orchestration failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
