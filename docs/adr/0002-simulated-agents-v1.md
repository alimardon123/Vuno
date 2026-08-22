# ADR-0002: Simulated Agents in v1 with Adapter Interface for Real Agents in v2

**Status:** Accepted
**Date:** 2025-01-01
**Decider:** orchestrator (Z.ai Code main)

## Context

The killer demo (falsification arc) requires agents to produce proposals, raise objections with evidence, and report benchmark results. Real agent execution requires (a) LLM API keys + budget, (b) a real sandboxed execution plane (repos, CI, load-test harnesses), and (c) genuine multi-model plurality (different model families for different priors). All of these are expensive, fragile, and out of scope for v1.

However, the user's explicit constraint: *"please make sure same design works for real agents too."* The agent layer must be designed so real agents can drop in later without redesign.

## Decision

We define an **AgentAdapter** interface that is the *only* way the substrate talks to agents. Both simulated and real agents implement it.

### The interface (TypeScript)

```typescript
// src/lib/agents/types.ts

export type AgentKind = 'independent' | 'personal-assistant';

export interface AgentManifest {
  id: string;                  // matches Agent.id in DB
  role: string;                // e.g. "Distributed Systems Architect"
  kind: AgentKind;
  modelName: string;           // e.g. "claude-3-5-sonnet" or "simulated/echo-1"
  harnessName: string;         // e.g. "claude-code" | "codex" | "gemini-cli" | "simulated"
  tools: string[];             // e.g. ["github.read", "benchmark.run"]
  permissions: string[];      // e.g. ["repo.read", "deploy.staging"]
}

export interface AgentContext {
  // what the adapter receives when invoked
  events: EventRecord[];       // recent relevant event spine slice
  claims: ClaimRecord[];       // relevant ledger claims (filtered by scope)
  workGraph: WorkGraphNode[]; // relevant nodes
  trigger: { type: string; payload: unknown };
}

export interface AgentResponse {
  // what the adapter returns — always expressed as typed events to append
  events: NewEventInput[];     // never mutates; only proposes appends
  claims: NewClaimInput[];     // proposed claims with status + provenance
}

export interface AgentAdapter {
  readonly manifest: AgentManifest;
  invoke(ctx: AgentContext): Promise<AgentResponse>;
  health(): Promise<{ ok: boolean; latencyMs?: number; note?: string }>;
}
```

### Critical design rule

The substrate **never** imports an agent directly. It calls `adapter.invoke(ctx)` and gets back typed events + claims to append. The adapter owns all model/harness/tool specifics. **This means:**

- v1 ships `SimulatedAgentAdapter` instances — each returns canned responses for known triggers, parameterized by the agent's role. They are deterministic and reproducible.
- v2 can ship `ZaiLlmAgentAdapter` (using z-ai-web-dev-sdk), `OpenAiAgentAdapter`, `LocalOllamaAgentAdapter`, etc. — each implementing the same interface. Drop-in.
- The substrate, ledger, gates, and debate engine **do not change** between v1 and v2. Only the registry of installed adapters changes.

### How simulated agents work in v1

- A simulated adapter holds a *script* of canned `AgentResponse`s keyed by trigger type + role.
- For the killer demo, the script covers: `ProposalOpened` → proposal text; `ObjectionRequested` → objection with evidence; `BenchmarkRun` → benchmark report.
- The script is hand-authored to demonstrate the *form* faithfully — real proposals, real evidence, real benchmark numbers, real falsification logic.
- The script lives in `src/lib/agents/scripts/<role>.ts` so it's editable and visible.

## Consequences

- **Pro:** The entire product surface (chat, decision pages, ledger, gates, debate state machine) is identical between v1 and v2. No "demo mode" branch in the UI.
- **Pro:** Tests can pin the simulated scripts exactly; the killer demo is reproducible from seed.
- **Pro:** When real adapters ship, they're additive — no breaking changes anywhere.
- **Con:** Simulated agents can't respond to arbitrary user input — but v1 doesn't have arbitrary user input. The killer demo is scripted; the user observes and navigates.
- **Con:** The adapter interface is load-bearing — if we get it wrong now, v2 hurts. Mitigation: the interface is minimal (invoke + health), and the response shape is *just typed events and claims*, which the substrate already understands.
