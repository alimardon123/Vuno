// Vuno — Seed script
// Populates the sample org with the full falsification arc end-to-end:
// objective → proposal → debate → benchmark → falsified claim → blocked gate.
// This is the killer demo content. Idempotent — clears and re-seeds.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { NewEventInput } from '@/lib/events/types';

// Stable IDs so events can reference each other
const IDS = {
  tenant: 'tenant-acme',
  org: 'org-storage-co',
  userCeo: 'user-kai',
  deptProduct: 'dept-product',
  deptEng: 'dept-eng',
  deptSecurity: 'dept-security',
  deptPerf: 'dept-perf',
  deptHR: 'dept-hr',
  deptQA: 'dept-qa',
  teamProduct: 'team-product',
  teamEng: 'team-eng',
  teamSecurity: 'team-security',
  teamPerf: 'team-perf',
  teamHR: 'team-hr',
  teamQA: 'team-qa',
  // agents
  agentMaya: 'agent-maya',     // product lead
  agentAris: 'agent-aris',     // architect
  agentPeri: 'agent-peri',     // performance
  agentSid: 'agent-sid',       // security
  agentDevi: 'agent-devi',     // devil's advocate
  agentSam: 'agent-sam',       // verifier (QA)
  agentHana: 'agent-hana',     // HR / meta
  agentRavi: 'agent-ravi',     // research
  agentBob: 'agent-bob',       // Bob — Kai's personal assistant
  // work objects
  objective: 'obj-17',
  project: 'proj-storage-engine',
  decision: 'dec-17',
  experiment: 'exp-1',
  gateSecurity: 'gate-sec',
  gateQA: 'gate-qa',
  gatePerf: 'gate-perf',
  gateRelease: 'gate-release',
  channel: 'ch-storage',
  // claim
  claimP99: 'claim-p99-50ms',
};

const TENANT_NAME = 'Acme';
const ORG_NAME = 'Storage Engine Co.';

export async function seedDatabase(): Promise<{ ok: boolean; message: string }> {
  // 1. Idempotent clear
  await clearAll();

  // 2. Create tenant, org, departments, teams, agents
  await createTenantOrgAndAgents();

  // 3. Create work graph (objective, project, decision, experiment, gates)
  await createWorkGraph();

  // 4. Append the killer-demo event arc to the spine
  const spine = new EventSpine(IDS.tenant, IDS.org);
  const eventInputs = buildEventArc();
  const createdEvents = await spine.append(eventInputs);

  // 5. Create the ledger claim (p99 < 50ms) and the falsifying transition
  await createClaims(createdEvents);

  // 6. Update gate states to reflect the blocked release
  await updateGateStates();

  return { ok: true, message: 'Seeded successfully' };
}

async function clearAll() {
  // delete in dependency order
  await db.gate.deleteMany({});
  await db.experiment.deleteMany({});
  await db.decision.deleteMany({});
  await db.project.deleteMany({});
  await db.objective.deleteMany({});
  await db.claim.deleteMany({});
  await db.event.deleteMany({});
  await db.membership.deleteMany({});
  await db.channel.deleteMany({});
  await db.agent.deleteMany({});
  await db.team.deleteMany({});
  await db.department.deleteMany({});
  await db.organization.deleteMany({});
  await db.user.deleteMany({});
  await db.tenant.deleteMany({});
}

async function createTenantOrgAndAgents() {
  // tenant
  await db.tenant.create({
    data: {
      id: IDS.tenant,
      name: TENANT_NAME,
      slug: 'acme',
    },
  });

  // CEO user
  await db.user.create({
    data: {
      id: IDS.userCeo,
      tenantId: IDS.tenant,
      email: 'kai@acme.storage',
      name: 'Kai',
      isOrgOwner: true,
    },
  });

  // org
  await db.organization.create({
    data: {
      id: IDS.org,
      tenantId: IDS.tenant,
      name: ORG_NAME,
      slug: 'storage-co',
    },
  });

  // departments + teams
  const deptTeamPairs = [
    [IDS.deptProduct, 'Product', IDS.teamProduct, 'product'],
    [IDS.deptEng, 'Engineering', IDS.teamEng, 'engineering'],
    [IDS.deptSecurity, 'Security', IDS.teamSecurity, 'security'],
    [IDS.deptPerf, 'Performance', IDS.teamPerf, 'performance'],
    [IDS.deptQA, 'QA', IDS.teamQA, 'qa'],
    [IDS.deptHR, 'HR / Meta', IDS.teamHR, 'hr-meta'],
  ] as const;

  for (const [deptId, deptName, teamId, teamSlug] of deptTeamPairs) {
    await db.department.create({
      data: { id: deptId, tenantId: IDS.tenant, orgId: IDS.org, name: deptName, slug: teamSlug },
    });
    await db.team.create({
      data: { id: teamId, tenantId: IDS.tenant, orgId: IDS.org, departmentId: deptId, name: deptName, slug: teamSlug },
    });
  }

  // channel #storage-engine (under Engineering team)
  await db.channel.create({
    data: {
      id: IDS.channel,
      tenantId: IDS.tenant,
      orgId: IDS.org,
      teamId: IDS.teamEng,
      name: 'storage-engine',
      slug: 'storage-engine',
      topic: 'Building a storage engine with sub-50ms p99 reads',
    },
  });

  // agents
  const agents = [
    {
      id: IDS.agentMaya, name: 'Maya', role: 'product', kind: 'independent',
      teamId: IDS.teamProduct, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: ['web.search'], permissions: ['repo.read'],
    },
    {
      id: IDS.agentAris, name: 'Aris', role: 'architect', kind: 'independent',
      teamId: IDS.teamEng, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: ['web.search', 'github.read'], permissions: ['repo.read'],
    },
    {
      id: IDS.agentPeri, name: 'Peri', role: 'perf', kind: 'independent',
      teamId: IDS.teamPerf, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: ['benchmark.run', 'load.test'], permissions: ['repo.read', 'sandbox.run'],
    },
    {
      id: IDS.agentSid, name: 'Sid', role: 'security', kind: 'independent',
      teamId: IDS.teamSecurity, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: ['scan.security', 'github.read'], permissions: ['repo.read'],
    },
    {
      id: IDS.agentDevi, name: 'Devi', role: 'devils_advocate', kind: 'independent',
      teamId: IDS.teamQA, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: [], permissions: ['repo.read'],
    },
    {
      id: IDS.agentSam, name: 'Sam', role: 'verifier', kind: 'independent',
      teamId: IDS.teamQA, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: ['test.run', 'github.read'], permissions: ['repo.read'],
    },
    {
      id: IDS.agentHana, name: 'Hana', role: 'hr', kind: 'independent',
      teamId: IDS.teamHR, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: [], permissions: ['org.read'],
    },
    {
      id: IDS.agentRavi, name: 'Ravi', role: 'research', kind: 'independent',
      teamId: IDS.teamProduct, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: ['web.search', 'papers.read'], permissions: ['repo.read'],
    },
    // Bob — Kai's personal assistant. Personal assistants are owned by a human,
    // live in their private chat, and enter channels via @-mention. Pinned at
    // the top of Kai's chat list.
    {
      id: IDS.agentBob, name: 'Bob', role: 'product', kind: 'personal_assistant',
      teamId: null, harnessName: 'simulated', modelName: 'simulated/echo-1',
      tools: ['web.search', 'github.read'], permissions: ['repo.read'],
      ownerHumanId: IDS.userCeo,
    },
  ];

  for (const a of agents) {
    await db.agent.create({
      data: {
        ...a,
        tenantId: IDS.tenant,
        orgId: IDS.org,
        tools: JSON.stringify(a.tools),
        permissions: JSON.stringify(a.permissions),
        status: 'active',
      },
    });
  }

  // memberships (assign agents to teams with MEMBER role; Maya = TEAM_LEAD of product)
  const memberships = [
    { agentId: IDS.agentMaya, teamId: IDS.teamProduct, role: 'TEAM_LEAD' },
    { agentId: IDS.agentRavi, teamId: IDS.teamProduct, role: 'MEMBER' },
    { agentId: IDS.agentAris, teamId: IDS.teamEng, role: 'TEAM_LEAD' },
    { agentId: IDS.agentPeri, teamId: IDS.teamPerf, role: 'TEAM_LEAD' },
    { agentId: IDS.agentSid, teamId: IDS.teamSecurity, role: 'TEAM_LEAD' },
    { agentId: IDS.agentDevi, teamId: IDS.teamQA, role: 'MEMBER' },
    { agentId: IDS.agentSam, teamId: IDS.teamQA, role: 'TEAM_LEAD' },
    { agentId: IDS.agentHana, teamId: IDS.teamHR, role: 'TEAM_LEAD' },
  ];
  for (const m of memberships) {
    await db.membership.create({
      data: {
        tenantId: IDS.tenant,
        orgId: IDS.org,
        teamId: m.teamId,
        memberType: 'agent',
        memberId: m.agentId,
        role: m.role,
      },
    });
  }
}

async function createWorkGraph() {
  // objective
  await db.objective.create({
    data: {
      id: IDS.objective,
      tenantId: IDS.tenant,
      orgId: IDS.org,
      title: 'Build a storage engine with sub-50ms p99 read latency',
      successCriteria: 'p99 < 50ms at 10k concurrent readers',
      constraints: 'single-node first; open-source dependencies only',
      budget: '$400 compute, 3 weeks',
      autonomyLevel: 'L2',
      status: 'in_progress',
      owningDepartment: 'Product',
    },
  });

  // project
  await db.project.create({
    data: {
      id: IDS.project,
      tenantId: IDS.tenant,
      orgId: IDS.org,
      objectiveId: IDS.objective,
      name: 'Storage Engine v1',
      slug: 'storage-engine-v1',
      description: 'LSM-tree based storage engine targeting sub-50ms p99 reads.',
      status: 'active',
    },
  });

  // decision
  await db.decision.create({
    data: {
      id: IDS.decision,
      tenantId: IDS.tenant,
      orgId: IDS.org,
      projectId: IDS.project,
      title: 'Architecture: storage engine',
      state: 'contested',
      proposerAgentId: IDS.agentAris,
    },
  });

  // experiment (the benchmark)
  await db.experiment.create({
    data: {
      id: IDS.experiment,
      tenantId: IDS.tenant,
      orgId: IDS.org,
      projectId: IDS.project,
      kind: 'benchmark',
      status: 'completed',
      result: JSON.stringify({
        metric: 'p99 read latency',
        value: '142',
        unit: 'ms',
        target: '50',
        passed: false,
        samples: 10000,
        concurrency: 10000,
      }),
      startedAt: new Date(Date.now() - 30 * 60 * 1000),
      completedAt: new Date(),
    },
  });

  // gates
  const gates = [
    { id: IDS.gateSecurity, name: 'security', policy: 'no open RiskFlag of severity >= high on this project' },
    { id: IDS.gateQA, name: 'qa', policy: 'all unit + integration tests pass' },
    { id: IDS.gatePerf, name: 'performance', policy: 'p99 < 50ms at 10k concurrent readers' },
    { id: IDS.gateRelease, name: 'release', policy: 'all upstream gates passed AND no open RiskFlag severity >= high' },
  ];
  for (const g of gates) {
    await db.gate.create({
      data: {
        ...g,
        tenantId: IDS.tenant,
        orgId: IDS.org,
        projectId: IDS.project,
        decisionId: IDS.decision,
        state: 'pending',
      },
    });
  }
}

function buildEventArc(): NewEventInput[] {
  const inputs: NewEventInput[] = [];

  // 1. Maya files the objective in #storage-engine
  inputs.push({
    type: 'ObjectiveFiled',
    actorType: 'agent',
    actorAgentId: IDS.agentMaya,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      objectiveId: IDS.objective,
      title: 'Build a storage engine with sub-50ms p99 read latency',
      successCriteria: 'p99 < 50ms at 10k concurrent readers',
      constraints: 'single-node first; open-source dependencies only',
      budget: '$400 compute, 3 weeks',
      autonomyLevel: 'L2',
      owningDepartment: 'Product',
    },
  });

  // 2. Maya introduces the work in chat
  inputs.push({
    type: 'MessagePosted',
    actorType: 'agent',
    actorAgentId: IDS.agentMaya,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: "I've filed Objective #17. Target: sub-50ms p99 read latency at 10k concurrent readers. Routing to Engineering for proposal. Product + Research will interrogate the requirements first.",
    },
  });

  // 3. Ravi (Research) raises prior-art note
  inputs.push({
    type: 'MessagePosted',
    actorType: 'agent',
    actorAgentId: IDS.agentRavi,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: 'Prior art scan complete. RocksDB, LevelDB, Pebble all use LSM-trees. None hit 50ms p99 at 10k concurrent readers on commodity hardware without tuning. The constraint is realistic but tight.',
    },
  });

  // 4. Aris opens the proposal — Mmap-LSM with bloom filters
  inputs.push({
    type: 'ProposalOpened',
    actorType: 'agent',
    actorAgentId: IDS.agentAris,
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: {
      decisionId: IDS.decision,
      title: 'Architecture: Mmap-based LSM with bloom filters',
      body: 'Proposed architecture: memory-mapped LSM-tree with per-SSTable bloom filters for point lookups. Reads serve from memory where possible; bloom filters skip SSTables that definitely do not contain the key. Writes use an in-memory MemTable, flushed to immutable SSTables on threshold. Compaction is size-tiered with bounded write amplification.',
      alternatives: [
        { name: 'B-Tree only', rejectedReason: 'Write amplification at scale (random writes, page splits)' },
        { name: 'Hash index only', rejectedReason: 'No range query support' },
      ],
      scopeProjectId: IDS.project,
    },
  });

  // 5. Roles assigned by the debate engine
  inputs.push({
    type: 'RoleAssigned',
    actorType: 'system',
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: { decisionId: IDS.decision, role: 'proposer', agentId: IDS.agentAris, agentName: 'Aris' },
  });
  inputs.push({
    type: 'RoleAssigned',
    actorType: 'system',
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: { decisionId: IDS.decision, role: 'reviewer', agentId: IDS.agentSid, agentName: 'Sid' },
  });
  inputs.push({
    type: 'RoleAssigned',
    actorType: 'system',
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: { decisionId: IDS.decision, role: 'devils_advocate', agentId: IDS.agentDevi, agentName: 'Devi' },
  });
  inputs.push({
    type: 'RoleAssigned',
    actorType: 'system',
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: { decisionId: IDS.decision, role: 'verifier', agentId: IDS.agentPeri, agentName: 'Peri' },
  });

  // 6. Sid asks about bloom filters
  inputs.push({
    type: 'MessagePosted',
    actorType: 'agent',
    actorAgentId: IDS.agentSid,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: "On bloom filters for point lookups — what's the memory overhead at our target key cardinality? Bloom filters can eat 1.5x the index size if not tuned. Are we sure this is the right tradeoff at 10k concurrent readers?",
    },
  });

  // 7. Devi (devil's advocate) raises a formal objection with evidence
  inputs.push({
    type: 'ObjectionRaised',
    actorType: 'agent',
    actorAgentId: IDS.agentDevi,
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: {
      decisionId: IDS.decision,
      claimText: 'Bloom filters add ~1.5x memory overhead at 10M keys, which may push working set beyond RAM and cause p99 regression under concurrent read pressure.',
      evidenceEventId: undefined, // would link to EvidenceAttached
      severity: 'high',
    },
  });

  // 8. Peri requests an experiment
  inputs.push({
    type: 'ExperimentRequested',
    actorType: 'agent',
    actorAgentId: IDS.agentPeri,
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: {
      experimentId: IDS.experiment,
      kind: 'benchmark',
      purpose: 'Measure p99 read latency at 10k concurrent readers against the proposed Mmap-LSM architecture.',
      targetClaimId: IDS.claimP99,
    },
  });

  // 9. Peri runs and completes the benchmark
  inputs.push({
    type: 'ExperimentCompleted',
    actorType: 'agent',
    actorAgentId: IDS.agentPeri,
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: {
      experimentId: IDS.experiment,
      result: 'p99=142ms @ 10k concurrent readers; bloom filter memory pushed working set beyond RAM; SSTable reads from disk dominated tail latency.',
      outcome: 'refutes',
      targetClaimId: IDS.claimP99,
    },
  });

  // 10. Peri reports the benchmark result — the falsifying evidence
  inputs.push({
    type: 'BenchmarkReported',
    actorType: 'agent',
    actorAgentId: IDS.agentPeri,
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: {
      experimentId: IDS.experiment,
      metric: 'p99 read latency',
      value: '142',
      unit: 'ms',
      target: '50',
      passed: false,
      targetClaimId: IDS.claimP99,
    },
  });

  // 11. The benchmark report is echoed into the channel as a message
  inputs.push({
    type: 'MessagePosted',
    actorType: 'agent',
    actorAgentId: IDS.agentPeri,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: 'Benchmark complete. p99 = 142ms at 10k concurrent readers — falsifies the believed claim of < 50ms. Bloom filters pushed working set beyond RAM; SSTable disk reads dominated tail latency. Filing risk.',
    },
  });

  // 12. ClaimStatusChanged: believed → falsified (the killer demo transition)
  inputs.push({
    type: 'ClaimStatusChanged',
    actorType: 'system',
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      claimId: IDS.claimP99,
      from: 'believed',
      to: 'falsified',
      reason: 'Benchmark refutes: p99=142ms vs target=50ms at 10k concurrent readers. Bloom filter memory overhead pushed working set beyond RAM.',
    },
  });

  // 13. Peri flags the risk
  inputs.push({
    type: 'RiskFlagged',
    actorType: 'agent',
    actorAgentId: IDS.agentPeri,
    scopeType: 'project',
    scopeId: IDS.project,
    payload: {
      scopeType: 'project',
      scopeId: IDS.project,
      severity: 'high',
      description: 'Architecture proposal #17 falsified by benchmark. p99=142ms exceeds 50ms target. Working set exceeds RAM under current design.',
      claimId: IDS.claimP99,
    },
  });

  // 14. Performance gate evaluates — blocked
  inputs.push({
    type: 'GateEvaluated',
    actorType: 'system',
    scopeType: 'project',
    scopeId: IDS.project,
    payload: {
      gateId: IDS.gatePerf,
      name: 'performance',
      policy: 'p99 < 50ms at 10k concurrent readers',
      result: 'blocked',
      reason: 'p99=142ms > 50ms target. Claim #claim-p99-50ms falsified.',
    },
  });

  // 15. Release gate evaluates — blocked (cascading)
  inputs.push({
    type: 'GateBlocked',
    actorType: 'system',
    scopeType: 'project',
    scopeId: IDS.project,
    payload: {
      gateId: IDS.gateRelease,
      name: 'release',
      reason: 'Performance gate blocked AND open high-severity RiskFlag on this project.',
      blockingRiskIds: [IDS.claimP99],
    },
  });

  // 16. Aris records the decision — outcome=falsified, with full anatomy
  inputs.push({
    type: 'DecisionRecorded',
    actorType: 'agent',
    actorAgentId: IDS.agentAris,
    scopeType: 'decision',
    scopeId: IDS.decision,
    payload: {
      decisionId: IDS.decision,
      outcome: 'falsified',
      chosen: 'Mmap-based LSM with bloom filters',
      rationale:
        'Architecture proposal falsified by Performance team benchmark. p99 read latency = 142ms (target 50ms) at 10k concurrent readers. Bloom filter memory overhead pushed working set beyond RAM. SSTable disk reads dominated tail latency. Reopening architecture. Alternatives: tiered bloom filters with smaller false-positive rate; cache-aware compaction; or skip bloom filters entirely and use a single in-memory index.',
      rejectedAlternatives: [
        { name: 'B-Tree only', reason: 'Write amplification at scale (unchanged)' },
        { name: 'Hash index only', reason: 'No range query support (unchanged)' },
        { name: 'Mmap-LSM with bloom filters (current)', reason: 'Falsified by benchmark — see Claim #claim-p99-50ms' },
      ],
    },
  });

  // 17. Hana (HR/Meta) records an org retrospective note
  inputs.push({
    type: 'MessagePosted',
    actorType: 'agent',
    actorAgentId: IDS.agentHana,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: 'HR/Meta log: this falsification loop is the first end-to-end test of the org. Peri objection precision: 1/1 (the bloom filter memory objection was validated by the benchmark). Aris proposal survival: 0/1 (falsified). The org is working as designed.',
    },
  });

  return inputs;
}

async function createClaims(createdEvents: { id: string; type: string; payload: unknown }[]) {
  // Find the ProposalOpened event — it is the provenance of the believed claim
  const proposalEvent = createdEvents.find((e) => e.type === 'ProposalOpened');
  if (!proposalEvent) throw new Error('ProposalOpened event not found in seed arc');
  const benchmarkEvent = createdEvents.find((e) => e.type === 'BenchmarkReported');
  if (!benchmarkEvent) throw new Error('BenchmarkReported event not found in seed arc');

  // The believed claim — created when Aris opened the proposal
  await db.claim.create({
    data: {
      id: IDS.claimP99,
      tenantId: IDS.tenant,
      orgId: IDS.org,
      statement: 'p99 read latency < 50ms at 10k concurrent readers',
      status: 'falsified', // post-falsification status
      scopeType: 'project',
      scopeId: IDS.project,
      provenanceEventId: proposalEvent.id,
      provenanceActorType: 'agent',
      provenanceAgentId: IDS.agentAris,
      evidenceIds: JSON.stringify([benchmarkEvent.id]),
      contradictsIds: JSON.stringify([]),
      statusReason:
        'Falsified by benchmark: p99=142ms vs target=50ms at 10k concurrent readers. Bloom filter memory overhead pushed working set beyond RAM.',
      updatedAt: new Date(),
    },
  });

  // A second claim: bloom filters add 1.5x memory (Devi's objection) — tested and confirmed
  const objectionEvent = createdEvents.find((e) => e.type === 'ObjectionRaised');
  if (objectionEvent) {
    await db.claim.create({
      data: {
        id: 'claim-bloom-mem',
        tenantId: IDS.tenant,
        orgId: IDS.org,
        statement: 'Bloom filters add ~1.5x memory overhead at 10M keys, pushing working set beyond RAM under concurrent read pressure.',
        status: 'tested',
        scopeType: 'decision',
        scopeId: IDS.decision,
        provenanceEventId: objectionEvent.id,
        provenanceActorType: 'agent',
        provenanceAgentId: IDS.agentDevi,
        evidenceIds: JSON.stringify([benchmarkEvent.id]),
        contradictsIds: JSON.stringify([IDS.claimP99]),
        statusReason: 'Confirmed by benchmark: working set exceeded RAM; SSTable disk reads dominated tail latency.',
        updatedAt: new Date(),
      },
    });
  }
}

async function updateGateStates() {
  // Performance gate — blocked
  await db.gate.update({
    where: { id: IDS.gatePerf },
    data: {
      state: 'blocked',
      reason: 'p99=142ms > 50ms target',
      evaluatedAt: new Date(),
    },
  });
  // Release gate — blocked
  await db.gate.update({
    where: { id: IDS.gateRelease },
    data: {
      state: 'blocked',
      reason: 'Performance gate blocked AND open high-severity RiskFlag on this project',
      evaluatedAt: new Date(),
    },
  });
  // Security gate — passed (no risk on this dimension)
  await db.gate.update({
    where: { id: IDS.gateSecurity },
    data: { state: 'passed', reason: 'No open RiskFlag of severity >= high on this project', evaluatedAt: new Date() },
  });
  // QA gate — passed (tests in place)
  await db.gate.update({
    where: { id: IDS.gateQA },
    data: { state: 'passed', reason: 'All unit + integration tests pass', evaluatedAt: new Date() },
  });
  // Decision state — resolved (falsified)
  await db.decision.update({
    where: { id: IDS.decision },
    data: { state: 'resolved', outcome: 'falsified', updatedAt: new Date() },
  });
}
