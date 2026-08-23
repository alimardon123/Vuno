// Vuno — Seed script
// Populates the sample org with the full falsification arc end-to-end:
// objective → proposal → debate → benchmark → falsified claim → blocked gate.
// This is the killer demo content. Idempotent — clears and re-seeds.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { assertClaim, transitionClaim } from '@/lib/ledger/claims';
import { evaluateGate } from '@/lib/gates';
import type { NewEventInput } from '@/lib/events/types';

// Stable IDs so events can reference each other
const IDS = {
  tenant: 'tenant-acme',
  org: 'org-storage-co',
  memberKai: 'mbr-kai',        // org owner (human)
  memberMira: 'mbr-mira',      // staff engineer (human) — parity is only real if a human works here too
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
  agentMaya: 'mbr-maya',       // product lead
  agentAris: 'mbr-aris',     // architect
  agentPeri: 'mbr-peri',     // performance
  agentSid: 'mbr-sid',       // security
  agentDevi: 'mbr-devi',     // devil's advocate
  agentSam: 'mbr-sam',       // verifier (QA)
  agentHana: 'mbr-hana',     // HR / meta
  agentRavi: 'mbr-ravi',     // research
  agentBob: 'mbr-bob',       // Bob — Kai's personal assistant
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
  await db.member.deleteMany({});   // cascades to HumanProfile / AgentProfile
  await db.team.deleteMany({});
  await db.department.deleteMany({});
  await db.organization.deleteMany({});
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

  // Humans are created after the org (they carry orgId), below.
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

  // ── The roster ─────────────────────────────────────────────────────────────
  // Humans and agents are the same table. The only difference is which profile
  // hangs off the member (ADR-0009). Read this list top to bottom: nothing about
  // it says "and then, separately, the humans".
  const roster: Array<{
    id: string;
    kind: 'human' | 'agent';
    displayName: string;
    handle: string;
    teamId: string | null;
    presenceState: string;
    presenceNote?: string;
    human?: { email: string; isOrgOwner?: boolean };
    agent?: { role: string; tools: string[]; permissions: string[]; ownerMemberId?: string };
  }> = [
    { id: IDS.memberKai, kind: 'human', displayName: 'Kai Alvarez', handle: 'kai', teamId: null,
      presenceState: 'available',
      human: { email: 'kai@acme.storage', isOrgOwner: true } },

    { id: IDS.memberMira, kind: 'human', displayName: 'Mira Okonkwo', handle: 'mira', teamId: IDS.teamEng,
      presenceState: 'busy', presenceNote: 'reviewing the WAL format proposal',
      human: { email: 'mira@acme.storage' } },

    { id: IDS.agentMaya, kind: 'agent', displayName: 'Maya', handle: 'maya', teamId: IDS.teamProduct,
      presenceState: 'available',
      agent: { role: 'product', tools: ['web.search'], permissions: ['repo.read'] } },

    { id: IDS.agentAris, kind: 'agent', displayName: 'Aris', handle: 'aris', teamId: IDS.teamEng,
      presenceState: 'busy', presenceNote: 'drafting the LSM proposal',
      agent: { role: 'architect', tools: ['web.search', 'github.read'], permissions: ['repo.read'] } },

    { id: IDS.agentPeri, kind: 'agent', displayName: 'Peri', handle: 'peri', teamId: IDS.teamPerf,
      presenceState: 'busy', presenceNote: 'running the 10k-reader benchmark',
      agent: { role: 'perf', tools: ['benchmark.run', 'load.test'], permissions: ['repo.read', 'sandbox.run'] } },

    { id: IDS.agentSid, kind: 'agent', displayName: 'Sid', handle: 'sid', teamId: IDS.teamSecurity,
      presenceState: 'available',
      agent: { role: 'security', tools: ['scan.security', 'github.read'], permissions: ['repo.read'] } },

    { id: IDS.agentDevi, kind: 'agent', displayName: 'Devi', handle: 'devi', teamId: IDS.teamQA,
      presenceState: 'available',
      agent: { role: 'devils_advocate', tools: [], permissions: ['repo.read'] } },

    { id: IDS.agentSam, kind: 'agent', displayName: 'Sam', handle: 'sam', teamId: IDS.teamQA,
      presenceState: 'away',
      agent: { role: 'verifier', tools: ['test.run', 'github.read'], permissions: ['repo.read'] } },

    { id: IDS.agentHana, kind: 'agent', displayName: 'Hana', handle: 'hana', teamId: IDS.teamHR,
      presenceState: 'available',
      agent: { role: 'hr', tools: [], permissions: ['org.read'] } },

    { id: IDS.agentRavi, kind: 'agent', displayName: 'Ravi', handle: 'ravi', teamId: IDS.teamProduct,
      presenceState: 'available',
      agent: { role: 'research', tools: ['web.search', 'papers.read'], permissions: ['repo.read'] } },

    // Bob works for Kai. He posts as Bob, everywhere, with the chip that says
    // whose assistant he is — never as Kai (ADR-0009 §1).
    { id: IDS.agentBob, kind: 'agent', displayName: 'Bob', handle: 'bob', teamId: null,
      presenceState: 'available',
      agent: { role: 'assistant', tools: ['web.search', 'github.read'], permissions: ['repo.read'],
               ownerMemberId: IDS.memberKai } },
  ];

  for (const m of roster) {
    await db.member.create({
      data: {
        id: m.id,
        tenantId: IDS.tenant,
        orgId: IDS.org,
        kind: m.kind,
        displayName: m.displayName,
        handle: m.handle,
        teamId: m.teamId,
        presenceState: m.presenceState,
        presenceNote: m.presenceNote ?? null,
        status: 'active',
        ...(m.human
          ? { human: { create: { email: m.human.email, isOrgOwner: m.human.isOrgOwner ?? false } } }
          : {}),
        ...(m.agent
          ? {
              agent: {
                create: {
                  role: m.agent.role,
                  tools: JSON.stringify(m.agent.tools),
                  permissions: JSON.stringify(m.agent.permissions),
                  ownerMemberId: m.agent.ownerMemberId ?? null,
                },
              },
            }
          : {}),
      },
    });
  }

  // ── Team membership ────────────────────────────────────────────────────────
  // One list. A human lead and an agent lead are the same row shape.
  const memberships = [
    { memberId: IDS.memberKai, teamId: IDS.teamProduct, role: 'ORG_OWNER' },
    { memberId: IDS.memberMira, teamId: IDS.teamEng, role: 'TEAM_LEAD' },
    { memberId: IDS.agentMaya, teamId: IDS.teamProduct, role: 'TEAM_LEAD' },
    { memberId: IDS.agentRavi, teamId: IDS.teamProduct, role: 'MEMBER' },
    { memberId: IDS.agentAris, teamId: IDS.teamEng, role: 'MEMBER' },
    { memberId: IDS.agentPeri, teamId: IDS.teamPerf, role: 'TEAM_LEAD' },
    { memberId: IDS.agentSid, teamId: IDS.teamSecurity, role: 'TEAM_LEAD' },
    { memberId: IDS.agentDevi, teamId: IDS.teamQA, role: 'MEMBER' },
    { memberId: IDS.agentSam, teamId: IDS.teamQA, role: 'TEAM_LEAD' },
    { memberId: IDS.agentHana, teamId: IDS.teamHR, role: 'HR_META' },
  ];
  for (const m of memberships) {
    await db.membership.create({
      data: {
        tenantId: IDS.tenant,
        orgId: IDS.org,
        teamId: m.teamId,
        memberId: m.memberId,
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
    {
      id: IDS.gateSecurity,
      name: 'security',
      policy: JSON.stringify({ none: { subject: 'risk', severityAtLeast: 'high' } }),
    },
    {
      id: IDS.gateQA,
      name: 'qa',
      policy: JSON.stringify({ none: { subject: 'claim', status: ['falsified'], statementContains: 'test' } }),
    },
    {
      id: IDS.gatePerf,
      name: 'performance',
      policy: JSON.stringify({ none: { subject: 'claim', status: ['falsified'] } }),
    },
    {
      id: IDS.gateRelease,
      name: 'release',
      policy: JSON.stringify({
        all: [
          { none: { subject: 'claim', status: ['falsified'] } },
          { none: { subject: 'risk', severityAtLeast: 'high' } },
        ],
      }),
    },
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
    actorType: 'member',
    actorMemberId: IDS.agentMaya,
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
    actorType: 'member',
    actorMemberId: IDS.agentMaya,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: "I've filed Objective #17. Target: sub-50ms p99 read latency at 10k concurrent readers. Routing to Engineering for proposal. Product + Research will interrogate the requirements first.",
    },
  });

  // 3. Ravi (Research) raises prior-art note
  inputs.push({
    type: 'MessagePosted',
    actorType: 'member',
    actorMemberId: IDS.agentRavi,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: 'Prior art scan complete. RocksDB, LevelDB, Pebble all use LSM-trees. None hit 50ms p99 at 10k concurrent readers on commodity hardware without tuning. The constraint is realistic but tight.',
    },
  });

  // 4. Aris opens the proposal — Mmap-LSM with bloom filters
  inputs.push({
    type: 'ProposalOpened',
    actorType: 'member',
    actorMemberId: IDS.agentAris,
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
    actorType: 'member',
    actorMemberId: IDS.agentSid,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: "On bloom filters for point lookups — what's the memory overhead at our target key cardinality? Bloom filters can eat 1.5x the index size if not tuned. Are we sure this is the right tradeoff at 10k concurrent readers?",
    },
  });

  // 7. Devi (devil's advocate) raises a formal objection with evidence
  inputs.push({
    type: 'ObjectionRaised',
    actorType: 'member',
    actorMemberId: IDS.agentDevi,
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
    actorType: 'member',
    actorMemberId: IDS.agentPeri,
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
    actorType: 'member',
    actorMemberId: IDS.agentPeri,
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
    actorType: 'member',
    actorMemberId: IDS.agentPeri,
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
    actorType: 'member',
    actorMemberId: IDS.agentPeri,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: 'Benchmark complete. p99 = 142ms at 10k concurrent readers — falsifies the believed claim of < 50ms. Bloom filters pushed working set beyond RAM; SSTable disk reads dominated tail latency. Filing risk.',
    },
  });

  // The falsification itself is not scripted here. transitionClaim appends the
  // ClaimStatusChanged when the claim actually moves, so the log holds one
  // transition per real move rather than a narrated one alongside it. Writing it
  // here as well produced an event naming a claim id that did not exist, which
  // replay would have reported as a phantom claim.

  // 13. Peri flags the risk
  inputs.push({
    type: 'RiskFlagged',
    actorType: 'member',
    actorMemberId: IDS.agentPeri,
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
    actorType: 'member',
    actorMemberId: IDS.agentAris,
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
    actorType: 'member',
    actorMemberId: IDS.agentHana,
    scopeType: 'channel',
    scopeId: IDS.channel,
    payload: {
      body: 'HR/Meta log: this falsification loop is the first end-to-end test of the org. Peri objection precision: 1/1 (the bloom filter memory objection was validated by the benchmark). Aris proposal survival: 0/1 (falsified). The org is working as designed.',
    },
  });

  return inputs;
}

async function createClaims(createdEvents: { id: string; type: string; payload: unknown }[]) {
  const proposalEvent = createdEvents.find((e) => e.type === 'ProposalOpened');
  if (!proposalEvent) throw new Error('ProposalOpened event not found in seed arc');
  const benchmarkEvent = createdEvents.find((e) => e.type === 'BenchmarkReported');
  if (!benchmarkEvent) throw new Error('BenchmarkReported event not found in seed arc');
  const objectionEvent = createdEvents.find((e) => e.type === 'ObjectionRaised');

  // The seed no longer writes a claim that is *born* falsified. It walks the
  // same path the product does: asserted when the proposal opens, believed once
  // the team accepts it, falsified when the benchmark comes back. The trail in
  // the ledger is therefore real, and replaying the log reproduces it.
  const p99 = await assertClaim({
    tenantId: IDS.tenant,
    orgId: IDS.org,
    statement: 'p99 read latency < 50ms at 10k concurrent readers',
    scopeType: 'project',
    scopeId: IDS.project,
    memberId: IDS.agentAris,
    provenanceEventId: proposalEvent.id,
  });

  await transitionClaim({
    claimId: p99.id,
    to: 'believed',
    reason: 'Architecture proposal reviewed; the team accepted the LSM approach on its reasoning.',
    memberId: IDS.agentAris,
  });

  await transitionClaim({
    claimId: p99.id,
    to: 'falsified',
    reason:
      'Benchmark measured p99 = 142ms at 10k concurrent readers against a 50ms target. Bloom filter memory overhead pushed the working set beyond RAM.',
    evidenceEventIds: [benchmarkEvent.id],
    memberId: IDS.agentPeri,
  });

  // Devi's objection, which the benchmark went on to confirm.
  if (objectionEvent) {
    const bloom = await assertClaim({
      tenantId: IDS.tenant,
      orgId: IDS.org,
      statement:
        'Bloom filters add ~1.5x memory overhead at 10M keys, pushing working set beyond RAM under concurrent read pressure.',
      scopeType: 'project',
      scopeId: IDS.project,
      memberId: IDS.agentDevi,
      provenanceEventId: objectionEvent.id,
    });
    await transitionClaim({
      claimId: bloom.id,
      to: 'believed',
      reason: 'Raised as an objection with a memory model behind it.',
      memberId: IDS.agentDevi,
    });
    await transitionClaim({
      claimId: bloom.id,
      to: 'tested',
      reason:
        'Confirmed by the benchmark: working set exceeded RAM and SSTable disk reads dominated tail latency.',
      evidenceEventIds: [benchmarkEvent.id],
      memberId: IDS.agentPeri,
    });
  }

  // A claim nobody has evidence for either way — the ledger should be able to
  // say "we do not know" as clearly as it says yes or no.
  await assertClaim({
    tenantId: IDS.tenant,
    orgId: IDS.org,
    statement: 'A single node is sufficient through the first 12 months of load.',
    scopeType: 'project',
    scopeId: IDS.project,
    memberId: IDS.memberMira,
  });
}

async function updateGateStates() {
  // Gate state is evaluated, never written. Each gate carries a predicate and
  // the engine runs it as a query over the ledger — so the seeded gates block
  // for a reason the UI can name, rather than because the seed said so
  // (ADR-0007 §C).
  const gates = await db.gate.findMany({ where: { orgId: IDS.org }, select: { id: true } });
  for (const g of gates) {
    await evaluateGate(g.id);
  }
}
