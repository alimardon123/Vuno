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
  // conversations
  channel: 'ch-storage',
  channelGeneral: 'ch-general',
  dmKaiBob: 'ch-dm-kai-bob',
  dmKaiMira: 'ch-dm-kai-mira',
  groupLaunch: 'ch-grp-launch',
  // claim
  claimP99: 'claim-p99-50ms',
};

// Everyone in the org, in roster order — the membership list for #general.
const ROSTER_IDS = [
  IDS.memberKai, IDS.memberMira, IDS.agentMaya, IDS.agentAris, IDS.agentPeri,
  IDS.agentSid, IDS.agentDevi, IDS.agentSam, IDS.agentHana, IDS.agentRavi, IDS.agentBob,
];

const TENANT_NAME = 'Acme';
const ORG_NAME = 'Storage Engine Co.';

export async function seedDatabase(): Promise<{ ok: boolean; message: string }> {
  // 1. Idempotent clear
  await clearAll();

  // 2. Create tenant, org, departments, teams, agents
  await createTenantOrgAndAgents();

  // 3. Create the conversations — channels, team rooms, DMs, the group chat
  await createConversations();

  // 4. Create work graph (objective, project, decision, experiment, gates)
  await createWorkGraph();

  // 5. Append the killer-demo event arc to the spine
  const spine = new EventSpine(IDS.tenant, IDS.org);
  const eventInputs = withTimeline(buildEventArc());
  const createdEvents = await spine.append(eventInputs);

  // 6. Create the ledger claim (p99 < 50ms) and the falsifying transition
  await createClaims(createdEvents);

  // 7. Update gate states to reflect the blocked release
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
  await db.channelMember.deleteMany({});
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

// Every team, and the org itself, gets a default place to talk — plus the DMs
// and the group chat that make the Chats tab real. Participants are rows, not a
// naming convention: a DM titles itself from whoever is in it.
async function createConversations() {
  const teamRooms = [
    [IDS.teamProduct, 'product', 'Product'],
    [IDS.teamEng, 'engineering', 'Engineering'],
    [IDS.teamSecurity, 'security', 'Security'],
    [IDS.teamPerf, 'performance', 'Performance'],
    [IDS.teamQA, 'qa', 'QA'],
    [IDS.teamHR, 'hr-meta', 'HR / Meta'],
  ] as const;

  const conversations: Array<{
    id: string;
    kind: 'channel' | 'team_room' | 'group' | 'dm';
    name: string;
    slug: string;
    teamId: string | null;
    topic: string | null;
    members: string[];
  }> = [
    {
      id: IDS.channelGeneral,
      kind: 'channel',
      name: 'general',
      slug: 'general',
      teamId: null,
      topic: 'Everyone in the org, humans and agents alike',
      members: ROSTER_IDS,
    },
    {
      id: IDS.channel,
      kind: 'channel',
      name: 'storage-engine',
      slug: 'storage-engine',
      teamId: IDS.teamEng,
      topic: 'Building a storage engine with sub-50ms p99 reads',
      members: [
        IDS.memberKai, IDS.memberMira, IDS.agentMaya, IDS.agentAris,
        IDS.agentPeri, IDS.agentSid, IDS.agentDevi, IDS.agentSam, IDS.agentRavi,
      ],
    },
    {
      id: IDS.dmKaiBob,
      kind: 'dm',
      name: 'Bob',
      slug: `dm-${[IDS.memberKai, IDS.agentBob].sort().join('-')}`,
      teamId: null,
      topic: null,
      members: [IDS.memberKai, IDS.agentBob],
    },
    {
      id: IDS.dmKaiMira,
      kind: 'dm',
      name: 'Mira Okonkwo',
      slug: `dm-${[IDS.memberKai, IDS.memberMira].sort().join('-')}`,
      teamId: null,
      topic: null,
      members: [IDS.memberKai, IDS.memberMira],
    },
    {
      id: IDS.groupLaunch,
      kind: 'group',
      name: 'Storage launch',
      slug: 'group-storage-launch',
      teamId: null,
      topic: 'Getting the engine in front of a customer',
      members: [IDS.memberKai, IDS.memberMira, IDS.agentMaya, IDS.agentAris, IDS.agentPeri],
    },
  ];

  for (const [teamId, slug, name] of teamRooms) {
    conversations.push({
      id: `ch-team-${slug}`,
      kind: 'team_room',
      name,
      slug: `team-${slug}`,
      teamId,
      topic: null,
      // A team room holds exactly the team, resolved from the memberships above.
      members: [],
    });
  }

  for (const c of conversations) {
    await db.channel.create({
      data: {
        id: c.id,
        tenantId: IDS.tenant,
        orgId: IDS.org,
        teamId: c.teamId,
        kind: c.kind,
        name: c.name,
        slug: c.slug,
        topic: c.topic,
      },
    });

    const memberIds =
      c.kind === 'team_room'
        ? (
            await db.membership.findMany({
              where: { teamId: c.teamId as string },
              select: { memberId: true },
            })
          ).map((m) => m.memberId)
        : c.members;

    for (const memberId of memberIds) {
      await db.channelMember.create({
        data: { tenantId: IDS.tenant, orgId: IDS.org, channelId: c.id, memberId },
      });
    }
  }
}

async function createWorkGraph() {
  // objective
  await db.objective.create({
    data: {
      // The seeded arc runs through proposal, objection, benchmark and decision,
      // so the objective's stage says that rather than sitting at 'filed'.
      stage: 'decision',
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

/**
 * Spread an ordered arc across real time.
 *
 * Every seeded event otherwise lands within the same second, so the whole
 * organisation reads "5m" and the day dividers never appear — a fortnight of
 * debate looks like it happened during lunch.
 *
 * Two shapes matter, and one schedule cannot produce both:
 *   - a technical debate is slow. Hours or days pass between the prior-art scan
 *     and the benchmark that refutes it.
 *   - a conversation is bursty. Nobody waits six hours to answer "what did I
 *     miss", then answers within the same thread.
 *
 * So time is allotted per *run* of consecutive events in one conversation:
 * older runs get wider windows (the easing exponent — today is dense, last week
 * is sparse), and a short run is capped to a burst regardless of how much room
 * its window offers.
 *
 * Deterministic: one clock read, no randomness, so a reseed is a reseed.
 */
function withTimeline(inputs: NewEventInput[], spanDays = 11): NewEventInput[] {
  const END = Date.now() - 8 * 60_000;
  const SPAN = spanDays * 24 * 3_600_000;
  const BURST_MS = 4 * 60_000;   // spacing inside a short exchange
  const BURST_MAX = 6;           // runs no longer than this read as one sitting

  // Consecutive events in the same conversation belong to the same run.
  const runs: number[][] = [];
  inputs.forEach((input, i) => {
    const prev = runs[runs.length - 1];
    if (prev && inputs[prev[prev.length - 1]].scopeId === input.scopeId) prev.push(i);
    else runs.push([i]);
  });

  // Boundaries b[0] .. b[runs.length], oldest to newest. Run r fills [b[r], b[r+1]],
  // so no two runs can land on the same instant and the newest ends at END.
  const n = runs.length;
  const b = Array.from({ length: n + 1 }, (_, r) => END - SPAN * Math.pow((n - r) / n, 1.6));

  const at = new Array<Date>(inputs.length);
  runs.forEach((run, r) => {
    const endsAt = b[r + 1];
    const window = endsAt - b[r];
    const gap =
      run.length <= BURST_MAX
        ? Math.min(BURST_MS, window / run.length)
        : window / run.length;

    // Anchored to the end of the window, so a burst sits at its close.
    run.forEach((i, k) => {
      at[i] = new Date(endsAt - (run.length - 1 - k) * gap);
    });
  });

  return inputs.map((input, i) => ({ ...input, occurredAt: at[i] }));
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


  // ── The chats ──────────────────────────────────────────────────────────────
  // Kai's DM with Bob. Bob answers under his own name; the chip that says whose
  // assistant he is does the rest (ADR-0009 §1).
  const msg = (
    scopeId: string,
    actorMemberId: string,
    body: string,
    onBehalfOfMemberId?: string,
  ): NewEventInput => ({
    type: 'MessagePosted',
    actorType: 'member',
    actorMemberId,
    ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
    scopeType: 'channel',
    scopeId,
    payload: { body },
  });

  inputs.push(
    msg(IDS.channelGeneral, IDS.agentHana,
      'Weekly org review is posted. Two things stand out: the release gate has been blocked for six days, and Performance is carrying the most reopened work of any team.'),
    msg(IDS.channelGeneral, IDS.memberKai,
      'Six days blocked is the one I care about. Peri, is the 142ms a property of the design or of the run?'),
    msg(IDS.channelGeneral, IDS.agentPeri,
      "Of the design. I re-ran it three times on a clean box; the spread was 4ms. It's the read amplification, not noise."),

    msg(IDS.dmKaiBob, IDS.memberKai,
      'What did I miss while I was out yesterday?'),
    msg(IDS.dmKaiBob, IDS.agentBob,
      "Three things. Peri's benchmark came back at 142ms p99 against your 50ms target, so the claim moved to falsified and the release gate blocked behind it. Aris opened a bloom-filter alternative in #storage-engine but hasn't attached evidence yet. And Mira asked you directly about the launch date — that one's still unanswered."),
    msg(IDS.dmKaiBob, IDS.memberKai,
      'Draft me a reply to Mira. Say the date holds only if the p99 work lands, and be honest that it might not.'),
    msg(IDS.dmKaiBob, IDS.agentBob,
      "Drafted. I'll answer in your thread with her, under my name and on your authority, the next time she raises it — the date is contingent on the read-path fix, and I'll flag it the moment the gate moves either way."),

    // A DM stays a DM. Kai summons Bob with @, Bob answers inside it, and Mira
    // sees the exchange — no second conversation is created.
    msg(IDS.dmKaiMira, IDS.memberMira,
      'Are we still holding the 12th for the customer preview? I need to tell them something today.'),
    msg(IDS.dmKaiMira, IDS.memberKai,
      '@Bob has the current state — Bob, give Mira the honest version.'),
    msg(IDS.dmKaiMira, IDS.agentBob,
      "The 12th holds only if the read-path work lands. Right now p99 is 142ms against a 50ms target and the release gate is blocked on that claim. Kai's position is that the date is contingent, not committed — I'd tell the customer the preview is likely but not confirmed, and I'll flag the moment the gate moves.",
      IDS.memberKai),
    msg(IDS.dmKaiMira, IDS.memberMira,
      "That's what I needed. I'll tell them likely-not-confirmed and hold the invite until the gate clears."),

    // One team room with traffic, the rest genuinely empty — both states are
    // real on day one and both need to render.
    msg('ch-team-engineering', IDS.memberMira,
      'Standup, async: Aris is on the bloom-filter alternative, I\'m on the WAL format review. Nothing blocked on a person.'),
    msg('ch-team-engineering', IDS.agentAris,
      "Correction on mine — I am blocked, on Peri's measurement. The alternative is written but I won't open it for decision without a number attached."),

    msg(IDS.groupLaunch, IDS.agentMaya,
      "Pulling the five of us into one place so the launch conversation stops living in three channels. Open question: do we preview on the current numbers or wait for the fix?"),
    msg(IDS.groupLaunch, IDS.agentAris,
      'Wait. Previewing a read path we already know is 3x over target buys one demo and costs the benchmark story.'),
    msg(IDS.groupLaunch, IDS.agentPeri,
      "I can have the bloom-filter measurement by Thursday. If it lands where Aris thinks it will, the question answers itself."),
    msg(IDS.groupLaunch, IDS.memberMira,
      'Then Thursday is the decision point, not the 12th. I can hold the customer that long.'),
  );

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
