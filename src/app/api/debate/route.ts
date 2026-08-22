// Vuno — /api/debate POST endpoint (CONCURRENT + STREAMING)
// Per the user's headline: "agents/teams pushing, discussing and debating and
// reviewing each other's work in real time concurrently just like humans in
// real corporate life."
//
// This refactor changes the debate from SEQUENTIAL (batch all events, append at end)
// to CONCURRENT + STREAMING:
//   1. Append + broadcast EACH event as it's produced (not batched)
//   2. Security + DevilsAdvocate wake IN PARALLEL after ProposalOpened (Promise.all)
//   3. Small delays (300-800ms) between phases for a "live conversation" feel
//   4. Typing indicators before each agent responds
//
// The debate chain:
//   Phase 1: Architect proposes (sequential — must happen first)
//   Phase 2: Security + DevilsAdvocate review IN PARALLEL (both respond to ProposalOpened)
//   Phase 3: Perf requests experiment (after ObjectionRaised — sequential dependency)
//   Phase 4: Perf runs benchmark (after ExperimentRequested — sequential dependency)
//   Phase 5: Verifier confirms (after BenchmarkReported)
//   Phase 6: System events (ClaimStatusChanged, RiskFlagged, GateEvaluated, GateBlocked)
//   Phase 7: DecisionRecorded (after benchmark result)
//   Phase 8: HR retrospective (after DecisionRecorded)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { broadcastEventAppended, broadcastTyping } from '@/lib/realtime/broadcast';
import type { NewEventInput, EventRecord, ClaimStatus } from '@/lib/events/types';
import type { AgentContext, AgentAdapter } from '@/lib/agents/types';
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
  title?: string;
  projectId?: string;
  channelId?: string;
}

interface DebateResponse {
  ok: boolean;
  decisionId?: string;
  eventsAppended?: number;
  message?: string;
  error?: string;
}

// Sleep helper for "live conversation" feel
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

    const project = body.projectId
      ? await db.project.findUnique({ where: { id: body.projectId } })
      : await db.project.findFirst({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' } });
    if (!project) {
      return NextResponse.json({ ok: false, error: 'No project found.' }, { status: 400 });
    }

    const channelId = body.channelId ?? 'ch-storage';
    const channel = await db.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      return NextResponse.json({ ok: false, error: `Channel ${channelId} not found.` }, { status: 400 });
    }

    // Fetch the agents we need
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

    // Create the Decision row first
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

    // Create gates
    const gateDefs = [
      { name: 'security', policy: 'no open RiskFlag of severity >= high on this project' },
      { name: 'qa', policy: 'all unit + integration tests pass' },
      { name: 'performance', policy: 'p99 < 50ms at 10k concurrent readers' },
      { name: 'release', policy: 'all upstream gates passed AND no open RiskFlag severity >= high' },
    ];
    const gates: Record<string, { id: string; name: string }> = {};
    for (const g of gateDefs) {
      const row = await db.gate.create({
        data: { tenantId: org.tenantId, orgId: org.id, projectId: project.id, decisionId, name: g.name, policy: g.policy, state: 'pending' },
      });
      gates[g.name] = { id: row.id, name: g.name };
    }

    // ─── Streaming helper: append + broadcast events as they're produced ─────
    const spine = new EventSpine(org.tenantId, org.id);
    let eventsAppended = 0;

    async function streamEvents(events: NewEventInput[]): Promise<EventRecord[]> {
      if (events.length === 0) return [];
      const created = await spine.append(events);
      eventsAppended += created.length;
      // Parse the payload from JSON string → object (Prisma stores it stringified,
      // but downstream adapters need the parsed object)
      const parsed = created.map((e) => ({
        ...e,
        payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
      })) as EventRecord[];
      // Broadcast each event individually so they stream to the UI one-by-one
      for (const evt of parsed) {
        void broadcastEventAppended({
          channelId: evt.scopeType === 'channel' ? evt.scopeId : undefined,
          scopeType: evt.scopeType,
          scopeId: evt.scopeId,
          event: evt,
        });
      }
      return parsed;
    }

    // Helper: send a typing indicator for an agent, wait, then stop typing
    async function sendTyping(agentId: string, agentName: string, channelId: string, durationMs: number) {
      void broadcastTyping({ channelId, userId: agentId, isTyping: true });
      await sleep(durationMs);
      void broadcastTyping({ channelId, userId: agentId, isTyping: false });
    }

    // Helper: invoke an adapter and stream its events
    async function invokeAndStream(
      agentId: string,
      triggerType: string,
      triggerPayload: unknown,
      contextEvents: EventRecord[],
      agentName: string,
    ): Promise<EventRecord[]> {
      const adapter = adapters[agentId];
      if (!adapter) return [];
      // Send typing indicator while the agent "thinks"
      await sendTyping(agentId, agentName, channelId, 400 + Math.random() * 400);
      const ctx: AgentContext = { events: contextEvents, claims: [], trigger: { type: triggerType, payload: triggerPayload } };
      const response = await adapter.invoke(ctx);
      return await streamEvents(response.events);
    }

    // ─── Phase 1: Architect proposes ────────────────────────────────────────
    const proposalTriggerPayload = { decisionId, projectId: project.id, title: body.title ?? 'Architecture: simulated proposal' };
    const architectAdapter = adapters[architect.id]!;
    const architectCtx: AgentContext = { events: [], claims: [], trigger: { type: 'ProposalRequested', payload: proposalTriggerPayload } };
    await sendTyping(architect.id, architect.name, channelId, 500 + Math.random() * 300);
    const architectResponse = await architectAdapter.invoke(architectCtx);
    const proposalCreated = await streamEvents(architectResponse.events);

    // Build the ProposalOpened event record for downstream context
    const proposalDbEvent = proposalCreated.find((e) => e.type === 'ProposalOpened');
    const proposalEventRecord: EventRecord | null = proposalDbEvent
      ? proposalDbEvent
      : {
          id: 'pending-proposal',
          seq: -1,
          type: 'ProposalOpened',
          payload: architectResponse.events.find((e) => e.type === 'ProposalOpened')!.payload,
          tenantId: org.tenantId, orgId: org.id, actorType: 'agent', actorAgentId: architect.id,
          scopeType: 'decision', scopeId: decisionId, visibility: 'org', createdAt: new Date().toISOString(),
        };

    // ─── Phase 2: Role assignments (system events) ──────────────────────────
    await sleep(200);
    const roleAssignments: NewEventInput[] = [
      { type: 'RoleAssigned', actorType: 'system', scopeType: 'decision', scopeId: decisionId,
        payload: { decisionId, role: 'proposer', agentId: architect.id, agentName: architect.name } },
      { type: 'RoleAssigned', actorType: 'system', scopeType: 'decision', scopeId: decisionId,
        payload: { decisionId, role: 'reviewer', agentId: security.id, agentName: security.name } },
      { type: 'RoleAssigned', actorType: 'system', scopeType: 'decision', scopeId: decisionId,
        payload: { decisionId, role: 'devils_advocate', agentId: devilsAdvocate.id, agentName: devilsAdvocate.name } },
      { type: 'RoleAssigned', actorType: 'system', scopeType: 'decision', scopeId: decisionId,
        payload: { decisionId, role: 'verifier', agentId: perf.id, agentName: perf.name } },
    ];
    await streamEvents(roleAssignments);

    // ─── Phase 3: Security + DevilsAdvocate review IN PARALLEL ───────────────
    // These two agents wake in parallel — they both respond to ProposalOpened
    // independently, like real colleagues seeing a Slack message and replying.
    // We pass ALL created events (including the architect's AgentThought events)
    // as context so downstream agents can see each other's reasoning and
    // reference thoughts using relatedThoughtId (memory graph edges).
    await sleep(300);
    const allContextEvents = [...proposalCreated, proposalEventRecord!].filter(Boolean);
    const [securityCreated, devilsCreated] = await Promise.all([
      invokeAndStream(security.id, 'ProposalOpened', proposalEventRecord!.payload, allContextEvents, security.name),
      invokeAndStream(devilsAdvocate.id, 'ProposalOpened', proposalEventRecord!.payload, allContextEvents, devilsAdvocate.name),
    ]);

    // Find the ObjectionRaised event from the devil's advocate
    const objectionDbEvent = devilsCreated.find((e) => e.type === 'ObjectionRaised');
    const objectionEventRecord: EventRecord | null = objectionDbEvent
      ? objectionDbEvent
      : null;

    // ─── Phase 4: Perf requests an experiment (after objection — sequential) ─
    let experimentEventRecord: EventRecord | null = null;
    if (objectionEventRecord) {
      await sleep(300);
      const perfContext = [...allContextEvents, ...devilsCreated, objectionEventRecord].filter(Boolean);
      const expCreated = await invokeAndStream(perf.id, 'ObjectionRaised', objectionEventRecord.payload, perfContext, perf.name);
      experimentEventRecord = expCreated.find((e) => e.type === 'ExperimentRequested') ?? null;
    }

    // ─── Phase 5: Perf runs the benchmark (after experiment — sequential) ────
    let benchmarkEventRecord: EventRecord | null = null;
    let benchmarkValue = '0';
    let benchmarkTarget = '50';
    if (experimentEventRecord) {
      await sleep(800); // Longer delay — benchmark takes time
      const benchCreated = await invokeAndStream(perf.id, 'ExperimentRequested', experimentEventRecord.payload, [experimentEventRecord], perf.name);
      benchmarkEventRecord = benchCreated.find((e) => e.type === 'BenchmarkReported') ?? null;
      if (benchmarkEventRecord) {
        const bp = benchmarkEventRecord.payload as { value: string; target: string };
        benchmarkValue = bp.value;
        benchmarkTarget = bp.target;
      }
    }

    // ─── Phase 6: Verifier confirms (after benchmark) ───────────────────────
    if (benchmarkEventRecord) {
      await sleep(300);
      await invokeAndStream(verifier.id, 'BenchmarkReported', benchmarkEventRecord.payload, [benchmarkEventRecord], verifier.name);
    }

    // ─── Phase 7: System events (claim falsified, risk, gates) ──────────────
    const claimId = `claim-${decisionId}`;
    const claimStatement = `p99 read latency < ${benchmarkTarget}ms at 10k concurrent readers`;
    if (benchmarkEventRecord) {
      await sleep(300);
      // ClaimStatusChanged (channel-scoped — shows in chat)
      await streamEvents([{
        type: 'ClaimStatusChanged', actorType: 'system', scopeType: 'channel', scopeId: channelId,
        payload: { claimId, from: 'believed' as ClaimStatus, to: 'falsified' as ClaimStatus,
          reason: `Benchmark refutes: p99=${benchmarkValue}ms vs target=${benchmarkTarget}ms at 10k concurrent readers.` },
      }]);
      // RiskFlagged (project-scoped)
      await streamEvents([{
        type: 'RiskFlagged', actorType: 'agent', actorAgentId: perf.id, scopeType: 'project', scopeId: project.id,
        payload: { scopeType: 'project', scopeId: project.id, severity: 'high',
          description: `Architecture proposal falsified by benchmark. p99=${benchmarkValue}ms exceeds ${benchmarkTarget}ms target.`,
          claimId },
      }]);
      // GateEvaluated: performance blocked
      await streamEvents([{
        type: 'GateEvaluated', actorType: 'system', scopeType: 'project', scopeId: project.id,
        payload: { gateId: gates.performance.id, name: 'performance', policy: 'p99 < 50ms at 10k concurrent readers',
          result: 'blocked', reason: `p99=${benchmarkValue}ms > ${benchmarkTarget}ms target. Claim ${claimId} falsified.` },
      }]);
      // GateBlocked: release blocked (cascading)
      await streamEvents([{
        type: 'GateBlocked', actorType: 'system', scopeType: 'project', scopeId: project.id,
        payload: { gateId: gates.release.id, name: 'release',
          reason: 'Performance gate blocked AND open high-severity RiskFlag on this project.',
          blockingRiskIds: [claimId] },
      }]);
    }

    // ─── Phase 8: DecisionRecorded (after benchmark result) ──────────────────
    if (benchmarkEventRecord) {
      await sleep(400);
      const proposalPayload = proposalEventRecord!.payload as { title: string; body: string; alternatives?: Array<{ name: string; rejectedReason: string }> };
      const decisionCreated = await streamEvents([{
        type: 'DecisionRecorded', actorType: 'agent', actorAgentId: architect.id, scopeType: 'decision', scopeId: decisionId,
        payload: { decisionId, outcome: 'falsified', chosen: proposalPayload.title,
          rationale: `Architecture proposal falsified by Performance team benchmark. p99=${benchmarkValue}ms (target ${benchmarkTarget}ms) at 10k concurrent readers. Working set exceeded RAM.`,
          rejectedAlternatives: [
            ...(proposalPayload.alternatives ?? []),
            { name: proposalPayload.title, reason: `Falsified by benchmark — see Claim ${claimId}` },
          ] },
      }]);
      const decisionRecordedRecord = decisionCreated[0] ?? null;

      // ─── Phase 9: HR retrospective (after decision recorded) ──────────────────
      if (decisionRecordedRecord) {
        await sleep(400);
        await invokeAndStream(hr.id, 'DecisionRecorded', decisionRecordedRecord.payload, [decisionRecordedRecord], hr.name);
      }
    }

    // ─── Create the claim in the DB ──────────────────────────────────────────
    if (benchmarkEventRecord) {
      await db.claim.create({
        data: {
          id: claimId, tenantId: org.tenantId, orgId: org.id,
          statement: claimStatement, status: 'falsified',
          scopeType: 'project', scopeId: project.id,
          provenanceEventId: proposalDbEvent?.id ?? benchmarkEventRecord.id,
          provenanceActorType: 'agent', provenanceAgentId: architect.id,
          evidenceIds: JSON.stringify([benchmarkEventRecord.id]),
          contradictsIds: JSON.stringify([]),
          statusReason: `Falsified by benchmark: p99=${benchmarkValue}ms vs target=${benchmarkTarget}ms at 10k concurrent readers.`,
          updatedAt: new Date(),
        },
      });
    }

    // ─── Update gate states ──────────────────────────────────────────────────
    if (benchmarkEventRecord) {
      await db.gate.update({ where: { id: gates.performance.id }, data: { state: 'blocked', reason: `p99=${benchmarkValue}ms > ${benchmarkTarget}ms target`, evaluatedAt: new Date() } });
      await db.gate.update({ where: { id: gates.release.id }, data: { state: 'blocked', reason: 'Performance gate blocked AND open high-severity RiskFlag', evaluatedAt: new Date() } });
      await db.gate.update({ where: { id: gates.security.id }, data: { state: 'passed', reason: 'No open RiskFlag of severity >= high', evaluatedAt: new Date() } });
      await db.gate.update({ where: { id: gates.qa.id }, data: { state: 'passed', reason: 'All unit + integration tests pass', evaluatedAt: new Date() } });
    }
    await db.decision.update({ where: { id: decisionId }, data: { state: 'resolved', outcome: 'falsified', updatedAt: new Date() } });

    return NextResponse.json({
      ok: true,
      decisionId,
      eventsAppended,
      message: `Debate completed. ${eventsAppended} events streamed. Claim ${claimId} falsified. Release gate blocked.`,
    });
  } catch (err) {
    console.error('Debate orchestration failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
