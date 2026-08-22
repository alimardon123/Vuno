# ADR-0006: Agent Adapter Interface and Registry

**Status:** Accepted
**Date:** 2025-01-01
**Decider:** orchestrator (Z.ai Code main)

## Context

User constraint: *"It should be able to handle multiple agents I installed on my system (or it can even install/config it)"* and *"please make sure same design works for real agents too."*

This means we need:
1. An **agent registry** — installed agents are first-class data, not prompts in code.
2. An **agent adapter interface** — the only way the substrate invokes an agent. Simulated in v1, real LLMs in v2.
3. An **install/config flow** — the user can install a new agent (select role, pick a model, pick a harness, set tools/permissions, assign to a team).

## Decision

### The Agent table

```prisma
model Agent {
  id            String   @id @default(cuid())
  tenantId      String
  orgId         String
  name          String   // "Distributed Systems Architect"
  kind          String   // 'independent' | 'personal_assistant'
  role          String   // 'architect' | 'engineer' | 'security' | 'perf' | 'hr' | 'product' | 'research' | ...
  modelName     String   // 'simulated/echo-1' in v1; 'claude-3-5-sonnet' etc. in v2
  harnessName   String   // 'simulated' in v1; 'claude-code' | 'codex' | 'gemini-cli' in v2
  tools         String   // JSON array of tool IDs
  permissions   String   // JSON array of permission IDs
  ownerHumanId  String?  // set only for personal assistants
  teamId        String?  // current team assignment
  status        String   // 'active' | 'retired' | 'pending'
  installedAt   DateTime @default(now())
  retiredAt     DateTime?
  metadata      String?  // JSON — model-specific config (temperature, system prompt path, etc.)

  @@index([tenantId, orgId, teamId])
  @@index([kind, status])
}
```

### The AgentAdapter interface (TypeScript)

See `src/lib/agents/types.ts` (defined in ADR-0002). Critical recap:

```typescript
export interface AgentAdapter {
  readonly manifest: AgentManifest;
  invoke(ctx: AgentContext): Promise<AgentResponse>;
  health(): Promise<{ ok: boolean; latencyMs?: number; note?: string }>;
}
```

- The substrate calls `adapter.invoke(ctx)` and gets back typed events + claims to append.
- The adapter owns all model/harness/tool specifics.
- The substrate, ledger, gates, and debate engine **do not change** between v1 and v2. Only the registry of installed adapters changes.

### The registry

A runtime map `Map<agentId, AgentAdapter>` populated at server startup:

```typescript
// src/lib/agents/registry.ts (server-only)

import type { AgentAdapter } from './types';
import { SimulatedArchitectAdapter } from './adapters/simulated-architect';
import { SimulatedPerfAdapter } from './adapters/simulated-perf';
// v2: import { ZaiLlmAdapter } from './adapters/zai-llm';
// v2: import { OpenAiAdapter } from './adapters/openai';

const adapters = new Map<string, AgentAdapter>();

export function registerAdapter(adapter: AgentAdapter) {
  adapters.set(adapter.manifest.id, adapter);
}

export function getAdapter(agentId: string): AgentAdapter | undefined {
  return adapters.get(agentId);
}

export async function loadInstalledAgents() {
  // read all active Agents from DB; for each, instantiate the appropriate
  // adapter based on harnessName; register in the map
}
```

### Install/config flow

A typed form (react-hook-form + zod):

```
Name:           [Distributed Systems Architect]
Kind:           ( ) Independent   ( ) Personal Assistant
Role:           [architect ▼]
Model:          [simulated/echo-1 ▼]   (v1 only simulated; v2 unlocks real models)
Harness:        [simulated ▼]          (v1 only simulated; v2 unlocks claude-code, codex, etc.)
Tools:          [✓] github.read  [✓] benchmark.run  [ ] deploy.staging
Permissions:    [✓] repo.read  [ ] repo.write  [ ] deploy.staging  [ ] deploy.prod
Team:           [Engineering ▼]
```

On submit:
1. Validate via zod
2. Create `Agent` row
3. Emit `AgentInstalled` event to the spine
4. Instantiate the appropriate adapter and register it in the runtime map

### Health check

The agent registry UI shows health badges (green/yellow/red) per agent. v1 simulated adapters always report `ok: true`. v2 real adapters actually call the model's ping endpoint.

## Consequences

- **Pro:** Installing an agent is a real action with a real event on the spine. The audit trail shows every org change.
- **Pro:** The same install/config UI works for simulated and real agents — only the model/harness dropdowns unlock more options in v2.
- **Pro:** Adapters are swappable without touching the substrate.
- **Con:** The adapter interface is load-bearing. If we discover it's insufficient, v2 adapters break. Mitigation: the interface is minimal (invoke + health) and the response shape is *just typed events and claims*, which the substrate already understands.
- **Risk:** In v1, simulated adapters are deterministic scripts — they can't respond to arbitrary user input. v1 doesn't have arbitrary user input; the killer demo is scripted. So this is fine.
