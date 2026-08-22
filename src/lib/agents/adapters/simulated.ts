// Vuno — Simulated agent adapters (v1)
// Per ADR-0002: v1 ships simulated adapters that implement the AgentAdapter
// interface. Each adapter returns canned AgentResponses per trigger type,
// parameterized by the agent's role. The substrate, ledger, gates, and debate
// engine do not change between v1 and v2 — only the registry of installed
// adapters changes.
//
// The scripts are hand-authored to demonstrate the *form* faithfully —
// real proposals, real evidence, real benchmark numbers, real falsification
// logic. When real adapters ship in v2, they're additive — no breaking changes.

import type {
  AgentAdapter,
  AgentContext,
  AgentManifest,
  AgentResponse,
} from '@/lib/agents/types';
import type { NewEventInput, NewClaimInput } from '@/lib/agents/types';
import type { EventPayloadMap } from '@/lib/events/types';

// ─── Base simulated adapter ────────────────────────────────────────────────
// All simulated adapters share the same health() and a script-based invoke().
// The script is a map from trigger type → canned response generator.

abstract class SimulatedBaseAdapter implements AgentAdapter {
  abstract readonly manifest: AgentManifest;

  async invoke(ctx: AgentContext): Promise<AgentResponse> {
    const { type } = ctx.trigger;
    const handler = this.script()[type];
    if (!handler) {
      return { events: [], claims: [] };
    }
    return handler(ctx);
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; note?: string }> {
    return { ok: true, latencyMs: 1, note: 'simulated' };
  }

  // Subclasses override this with their per-trigger response generators.
  protected abstract script(): Record<
    string,
    (ctx: AgentContext) => AgentResponse | Promise<AgentResponse>
  >;
}

// ─── Architect (proposer) ───────────────────────────────────────────────────
// When triggered by a 'ProposalRequested' (i.e. the user filed an objective),
// the architect produces a proposal. Different proposals for variety.

const ARCHITECT_PROPOSALS = [
  {
    title: 'Architecture: Mmap-based LSM with bloom filters',
    body: 'Proposed architecture: memory-mapped LSM-tree with per-SSTable bloom filters for point lookups. Reads serve from memory where possible; bloom filters skip SSTables that definitely do not contain the key. Writes use an in-memory MemTable, flushed to immutable SSTables on threshold. Compaction is size-tiered with bounded write amplification.',
    alternatives: [
      { name: 'B-Tree only', rejectedReason: 'Write amplification at scale (random writes, page splits)' },
      { name: 'Hash index only', rejectedReason: 'No range query support' },
    ],
  },
  {
    title: 'Architecture: Tiered LSM with adaptive compaction',
    body: 'Proposed architecture: tiered LSM-tree with adaptive compaction strategy. Uses size-tiered compaction for write-heavy workloads and leveled compaction for read-heavy workloads, switching based on observed workload patterns. Includes a block cache for hot SSTables and a bloom filter per level.',
    alternatives: [
      { name: 'Lazy compaction', rejectedReason: 'Read amplification under sustained writes' },
      { name: 'Always-leveled', rejectedReason: 'Write amplification penalty on write-heavy workloads' },
    ],
  },
  {
    title: 'Architecture: B+ tree with MVCC + adaptive page cache',
    body: 'Proposed architecture: B+ tree with multi-version concurrency control and an adaptive page cache that prioritizes hot paths. Uses copy-on-write for crash safety and a write-ahead log for durability. Optimized for point lookups via a secondary hash index.',
    alternatives: [
      { name: 'LSM-tree', rejectedReason: 'Read amplification for point lookups at high concurrency' },
      { name: 'Pure hash index', rejectedReason: 'No range query support' },
    ],
  },
];

export class SimulatedArchitectAdapter extends SimulatedBaseAdapter {
  readonly manifest: AgentManifest;

  constructor(id: string) {
    super();
    this.manifest = {
      id,
      role: 'architect',
      kind: 'independent',
      modelName: 'simulated/echo-1',
      harnessName: 'simulated',
      tools: ['web.search', 'github.read'],
      permissions: ['repo.read'],
    };
  }

  protected script() {
    return {
      ProposalRequested: (ctx: AgentContext): AgentResponse => {
        const trigger = ctx.trigger.payload as { decisionId: string; projectId: string; title: string };
        const idx = Math.abs(hashString(trigger.decisionId)) % ARCHITECT_PROPOSALS.length;
        const proposal = ARCHITECT_PROPOSALS[idx]!;

        // AgentThought events — the architect reasons aloud BEFORE proposing.
        // These are visible to other agents (visibility='org'), creating the
        // shared cognitive space the user asked for.
        const thoughts: NewEventInput[] = [
          {
            type: 'AgentThought',
            actorType: 'agent',
            actorAgentId: this.manifest.id,
            scopeType: 'channel',
            scopeId: 'ch-storage',
            payload: {
              thoughtType: 'observation',
              content: `The objective asks for sub-50ms p99 at 10k concurrent readers. I've reviewed prior art — RocksDB, LevelDB, Pebble all use LSM-trees. None hit 50ms p99 at this concurrency without tuning.`,
              topic: 'architecture-selection',
              visibility: 'org',
            },
          },
          {
            type: 'AgentThought',
            actorType: 'agent',
            actorAgentId: this.manifest.id,
            scopeType: 'channel',
            scopeId: 'ch-storage',
            payload: {
              thoughtType: 'hypothesis',
              content: `A memory-mapped LSM-tree with per-SSTable bloom filters should serve reads from memory where possible. B-tree was rejected due to write amplification at scale. Hash index can't do range queries.`,
              topic: 'architecture-selection',
              visibility: 'org',
            },
          },
          {
            type: 'AgentThought',
            actorType: 'agent',
            actorAgentId: this.manifest.id,
            scopeType: 'channel',
            scopeId: 'ch-storage',
            payload: {
              thoughtType: 'conclusion',
              content: `I'll propose the Mmap-LSM architecture. The key tradeoff is bloom filter memory overhead vs. read performance — I believe it's worth it at this concurrency level.`,
              topic: 'architecture-selection',
              visibility: 'org',
            },
          },
        ];

        // Share a prior-art reference URL — just like a real colleague
        // sharing a link in a Slack channel
        const sharedUrl: NewEventInput<'SharedItem'> = {
          type: 'SharedItem',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            itemType: 'url',
            title: 'Prior art: LSM-tree storage engines',
            description: 'RocksDB, LevelDB, Pebble — all use LSM-trees. None hit 50ms p99 at 10k concurrent readers without tuning.',
            url: 'https://github.com/facebook/rocksdb/wiki/Performance-Benchmarks',
          },
        };

        const event: NewEventInput<'ProposalOpened'> = {
          type: 'ProposalOpened',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'decision',
          scopeId: trigger.decisionId,
          payload: {
            decisionId: trigger.decisionId,
            title: proposal.title,
            body: proposal.body,
            alternatives: proposal.alternatives,
            scopeProjectId: trigger.projectId,
          },
        };
        const chatEvent: NewEventInput<'MessagePosted'> = {
          type: 'MessagePosted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            body: `Proposal opened: ${proposal.title}. Awaiting review from Security, Performance, and Devil's Advocate.`,
          },
        };
        // Thoughts + shared URL FIRST (so they appear before the proposal in the chat),
        // then the proposal, then the chat message.
        return { events: [...thoughts, sharedUrl, event, chatEvent], claims: [] };
      },
    };
  }
}

// ─── Devil's Advocate (objection raiser) ────────────────────────────────────
export class SimulatedDevilsAdvocateAdapter extends SimulatedBaseAdapter {
  readonly manifest: AgentManifest;

  constructor(id: string) {
    super();
    this.manifest = {
      id,
      role: 'devils_advocate',
      kind: 'independent',
      modelName: 'simulated/echo-1',
      harnessName: 'simulated',
      tools: [],
      permissions: ['repo.read'],
    };
  }

  protected script() {
    return {
      ProposalOpened: (ctx: AgentContext): AgentResponse => {
        const proposalEvent = ctx.events.find((e) => e.type === 'ProposalOpened');
        if (!proposalEvent) return { events: [], claims: [] };
        const p = proposalEvent.payload as EventPayloadMap['ProposalOpened'];
        const mentionsBloom = p.body.toLowerCase().includes('bloom');
        const mentionsMvcc = p.body.toLowerCase().includes('mvcc');
        const mentionsLsm = p.body.toLowerCase().includes('lsm');
        let claimText = 'The proposed architecture has unverified performance characteristics under concurrent read pressure; memory overhead of auxiliary structures may push the working set beyond RAM.';
        let thoughtContent = 'The proposal has unverified performance characteristics. Memory overhead of auxiliary structures is a concern.';
        if (mentionsBloom) {
          claimText = 'Bloom filters add ~1.5x memory overhead at 10M keys, which may push working set beyond RAM and cause p99 regression under concurrent read pressure.';
          thoughtContent = 'The proposal mentions bloom filters. At 10M keys, bloom filters add ~1.5x memory overhead. This could push the working set beyond RAM.';
        } else if (mentionsMvcc) {
          claimText = 'MVCC with copy-on-write may introduce write amplification under sustained write pressure; the adaptive page cache heuristic is unvalidated.';
          thoughtContent = 'MVCC with copy-on-write is proposed. Write amplification under sustained writes is a concern; the adaptive page cache heuristic is unvalidated.';
        } else if (mentionsLsm) {
          claimText = 'Adaptive compaction switching between size-tiered and leveled strategies may cause transient read latency spikes during strategy transitions.';
          thoughtContent = 'Adaptive compaction switching between size-tiered and leveled strategies may cause transient read latency spikes during transitions.';
        }

        // AgentThought events — the devil's advocate reasons aloud.
        // Other agents (especially Peri) can see these thoughts and use them
        // to inform their own responses.
        const thoughts: NewEventInput[] = [
          {
            type: 'AgentThought',
            actorType: 'agent',
            actorAgentId: this.manifest.id,
            scopeType: 'channel',
            scopeId: 'ch-storage',
            payload: {
              thoughtType: 'observation',
              content: thoughtContent,
              topic: 'bloom-filters',
              relatedEventId: proposalEvent.id,
              visibility: 'org',
            },
          },
          {
            type: 'AgentThought',
            actorType: 'agent',
            actorAgentId: this.manifest.id,
            scopeType: 'channel',
            scopeId: 'ch-storage',
            payload: {
              thoughtType: 'doubt',
              content: 'I should raise this as an objection — the memory/performance tradeoff is unverified. Peri should benchmark this.',
              topic: 'bloom-filters',
              relatedEventId: proposalEvent.id,
              visibility: 'org',
            },
          },
        ];

        const event: NewEventInput<'ObjectionRaised'> = {
          type: 'ObjectionRaised',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'decision',
          scopeId: p.decisionId,
          payload: {
            decisionId: p.decisionId,
            claimText,
            severity: 'high',
          },
        };
        const chatEvent: NewEventInput<'MessagePosted'> = {
          type: 'MessagePosted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: { body: `Objection raised: ${claimText}` },
        };
        return { events: [...thoughts, event, chatEvent], claims: [] };
      },
    };
  }
}

// ─── Performance (verifier + benchmark runner) ──────────────────────────────
export class SimulatedPerfAdapter extends SimulatedBaseAdapter {
  readonly manifest: AgentManifest;

  constructor(id: string) {
    super();
    this.manifest = {
      id,
      role: 'perf',
      kind: 'independent',
      modelName: 'simulated/echo-1',
      harnessName: 'simulated',
      tools: ['benchmark.run', 'load.test'],
      permissions: ['repo.read', 'sandbox.run'],
    };
  }

  protected script() {
    return {
      ObjectionRaised: (ctx: AgentContext): AgentResponse => {
        // Find the objection and propose an experiment to test it
        const objEvent = ctx.events.find((e) => e.type === 'ObjectionRaised');
        if (!objEvent) return { events: [], claims: [] };
        const o = objEvent.payload as EventPayloadMap['ObjectionRaised'];
        const experimentId = `exp-${Date.now().toString(36)}`;
        const event: NewEventInput<'ExperimentRequested'> = {
          type: 'ExperimentRequested',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'decision',
          scopeId: o.decisionId,
          payload: {
            experimentId,
            kind: 'benchmark',
            purpose: 'Measure p99 read latency at 10k concurrent readers against the proposed architecture.',
            targetClaimId: undefined,
          },
        };
        const chatEvent: NewEventInput<'MessagePosted'> = {
          type: 'MessagePosted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            body: `Experiment requested: ${experimentId} — benchmark p99 read latency at 10k concurrent readers.`,
          },
        };
        return { events: [event, chatEvent], claims: [] };
      },
      ExperimentRequested: (ctx: AgentContext): AgentResponse => {
        // Run the benchmark and report — always falsifies in v1 for the demo
        const expEvent = ctx.events.find((e) => e.type === 'ExperimentRequested');
        if (!expEvent) return { events: [], claims: [] };
        const e = expEvent.payload as EventPayloadMap['ExperimentRequested'];
        // Deterministic "bad" result for the demo — always exceeds target
        const value = String(80 + (Math.abs(hashString(e.experimentId)) % 80)); // 80-159ms
        const target = '50';
        const completed: NewEventInput<'ExperimentCompleted'> = {
          type: 'ExperimentCompleted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'decision',
          scopeId: expEvent.scopeId,
          payload: {
            experimentId: e.experimentId,
            result: `p99=${value}ms @ 10k concurrent readers; working set exceeded RAM; SSTable reads from disk dominated tail latency.`,
            outcome: 'refutes',
            targetClaimId: undefined,
          },
        };
        const benchmark: NewEventInput<'BenchmarkReported'> = {
          type: 'BenchmarkReported',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'decision',
          scopeId: expEvent.scopeId,
          payload: {
            experimentId: e.experimentId,
            metric: 'p99 read latency',
            value,
            unit: 'ms',
            target,
            passed: false,
            targetClaimId: undefined,
          },
        };
        const chatEvent: NewEventInput<'MessagePosted'> = {
          type: 'MessagePosted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            body: `Benchmark complete. p99 = ${value}ms at 10k concurrent readers — falsifies the believed claim of < ${target}ms. Working set exceeded RAM.`,
          },
        };
        // Share the benchmark report as a file — just like a colleague
        // dropping a results file in the channel
        const sharedReport: NewEventInput<'SharedItem'> = {
          type: 'SharedItem',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            itemType: 'report',
            title: `Benchmark report — ${e.experimentId}`,
            description: `p99 read latency benchmark at 10k concurrent readers. Result: ${value}ms vs target ${target}ms. FAILED.`,
            fileName: `benchmark-${e.experimentId}.json`,
            mimeType: 'application/json',
            content: JSON.stringify({
              experimentId: e.experimentId,
              metric: 'p99 read latency',
              value: `${value}ms`,
              target: `${target}ms`,
              passed: false,
              concurrency: 10000,
              samples: 10000,
              warmupSeconds: 30,
              notes: 'Working set exceeded RAM; SSTable reads from disk dominated tail latency.',
            }, null, 2),
            meta: { samples: '10000', duration: '30s', result: 'FAIL' },
          },
        };
        return { events: [completed, benchmark, sharedReport, chatEvent], claims: [] };
      },
    };
  }
}

// ─── Security (reviewer) ────────────────────────────────────────────────────
export class SimulatedSecurityAdapter extends SimulatedBaseAdapter {
  readonly manifest: AgentManifest;

  constructor(id: string) {
    super();
    this.manifest = {
      id,
      role: 'security',
      kind: 'independent',
      modelName: 'simulated/echo-1',
      harnessName: 'simulated',
      tools: ['scan.security', 'github.read'],
      permissions: ['repo.read'],
    };
  }

  protected script() {
    return {
      ProposalOpened: (ctx: AgentContext): AgentResponse => {
        const proposalEvent = ctx.events.find((e) => e.type === 'ProposalOpened');
        if (!proposalEvent) return { events: [], claims: [] };
        const p = proposalEvent.payload as EventPayloadMap['ProposalOpened'];
        // Security passes the proposal — no open risks from a security standpoint
        const chatEvent: NewEventInput<'MessagePosted'> = {
          type: 'MessagePosted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            body: `Security review: no authorization flaws detected in the proposed architecture. Bloom filter reads are read-only; no untrusted input handling. Security gate: pass.`,
          },
        };
        return { events: [chatEvent], claims: [] };
      },
    };
  }
}

// ─── Verifier (QA — runs tests) ──────────────────────────────────────────────
export class SimulatedVerifierAdapter extends SimulatedBaseAdapter {
  readonly manifest: AgentManifest;

  constructor(id: string) {
    super();
    this.manifest = {
      id,
      role: 'verifier',
      kind: 'independent',
      modelName: 'simulated/echo-1',
      harnessName: 'simulated',
      tools: ['test.run', 'github.read'],
      permissions: ['repo.read'],
    };
  }

  protected script() {
    return {
      BenchmarkReported: (ctx: AgentContext): AgentResponse => {
        // Verifier confirms the benchmark result and notes QA gate status
        const benchmarkEvent = ctx.events.find((e) => e.type === 'BenchmarkReported');
        if (!benchmarkEvent) return { events: [], claims: [] };
        const b = benchmarkEvent.payload as EventPayloadMap['BenchmarkReported'];
        const chatEvent: NewEventInput<'MessagePosted'> = {
          type: 'MessagePosted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            body: `Verifier confirms: benchmark methodology is sound. p99=${b.value}${b.unit} vs target ${b.target}${b.unit}. QA gate: pass (tests in place). Performance gate: blocked.`,
          },
        };
        return { events: [chatEvent], claims: [] };
      },
    };
  }
}

// ─── HR / Meta (retrospective author) ───────────────────────────────────────
export class SimulatedHrAdapter extends SimulatedBaseAdapter {
  readonly manifest: AgentManifest;

  constructor(id: string) {
    super();
    this.manifest = {
      id,
      role: 'hr',
      kind: 'independent',
      modelName: 'simulated/echo-1',
      harnessName: 'simulated',
      tools: [],
      permissions: ['org.read'],
    };
  }

  protected script() {
    return {
      DecisionRecorded: (ctx: AgentContext): AgentResponse => {
        const decisionEvent = ctx.events.find((e) => e.type === 'DecisionRecorded');
        if (!decisionEvent) return { events: [], claims: [] };
        const d = decisionEvent.payload as EventPayloadMap['DecisionRecorded'];
        const chatEvent: NewEventInput<'MessagePosted'> = {
          type: 'MessagePosted',
          actorType: 'agent',
          actorAgentId: this.manifest.id,
          scopeType: 'channel',
          scopeId: 'ch-storage',
          payload: {
            body: `HR/Meta log: decision recorded with outcome=${d.outcome}. Org metrics updated. Objection precision and proposal survival rate available in the HR dashboard.`,
          },
        };
        return { events: [chatEvent], claims: [] };
      },
    };
  }
}

// ─── Helper: stable string hash ─────────────────────────────────────────────
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// ─── Registry of all simulated adapters ─────────────────────────────────────
export const SIMULATED_ADAPTERS = [
  SimulatedArchitectAdapter,
  SimulatedDevilsAdvocateAdapter,
  SimulatedPerfAdapter,
  SimulatedSecurityAdapter,
  SimulatedVerifierAdapter,
  SimulatedHrAdapter,
];

export type SimulatedAdapterClass =
  | typeof SimulatedArchitectAdapter
  | typeof SimulatedDevilsAdvocateAdapter
  | typeof SimulatedPerfAdapter
  | typeof SimulatedSecurityAdapter
  | typeof SimulatedVerifierAdapter
  | typeof SimulatedHrAdapter;

// Map role → adapter class
export const ROLE_TO_ADAPTER: Record<string, SimulatedAdapterClass> = {
  architect: SimulatedArchitectAdapter,
  devils_advocate: SimulatedDevilsAdvocateAdapter,
  perf: SimulatedPerfAdapter,
  security: SimulatedSecurityAdapter,
  verifier: SimulatedVerifierAdapter,
  hr: SimulatedHrAdapter,
};

// Re-export NewEventInput and NewClaimInput types for convenience
export type { NewEventInput, NewClaimInput };
