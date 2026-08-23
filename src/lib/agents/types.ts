// Vuno — Agent adapter interface
// Per ADR-0002 and ADR-0006. The ONLY way the substrate talks to agents.
// v1 ships simulated adapters; v2 drops in real LLM adapters — same interface.

import type { EventRecord, NewEventInput, ClaimStatus, ScopeType } from '@/lib/events/types';

export type AgentKind = 'independent' | 'personal_assistant';

export interface AgentManifest {
  id: string;                  // matches Agent.id in DB
  role: string;                // e.g. "architect" | "perf" | "security" | ...
  kind: AgentKind;
  modelName: string;           // 'simulated/echo-1' in v1
  harnessName: string;         // 'simulated' in v1
  tools: string[];
  permissions: string[];
}

/**
 * Where an agent is acting. Required: without it an adapter has no way to say
 * which channel or decision its events belong to, and the only alternative is
 * hardcoding one — which is what the LLM adapter did before this existed.
 */
export interface AgentScope {
  scopeType: ScopeType;
  scopeId: string;
  /** Scope for claims the agent proposes; claims belong to a project, not a channel. */
  projectId?: string;
}

export interface AgentContext {
  scope: AgentScope;           // where this invocation is acting
  events: EventRecord[];       // recent relevant event spine slice
  claims: AgentClaimRecord[];  // relevant ledger claims (filtered by scope)
  trigger: { type: string; payload: unknown };
}

export interface AgentClaimRecord {
  id: string;
  statement: string;
  status: ClaimStatus;
  scopeType: string;
  scopeId: string;
}

export interface NewClaimInput {
  statement: string;
  status: ClaimStatus;
  scopeType: string;
  scopeId: string;
  provenanceEventId?: string;
  statusReason?: string;
  evidenceIds?: string[];
  contradictsIds?: string[];
  supersedesId?: string;
}

export interface AgentResponse {
  events: NewEventInput[];      // typed events to append — never mutates
  claims: NewClaimInput[];     // proposed claims with status + provenance
}

export interface AgentAdapter {
  readonly manifest: AgentManifest;
  invoke(ctx: AgentContext): Promise<AgentResponse>;
  health(): Promise<{ ok: boolean; latencyMs?: number; note?: string }>;
}

// Role labels (for UI rendering)
export const ROLE_LABELS: Record<string, string> = {
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
  ceo: 'Org Owner (CEO)',
};

// Lucide icon glyph per role (used in avatars and agent cards)
export const ROLE_ICONS: Record<string, string> = {
  architect: 'Cpu',
  engineer: 'Code2',
  security: 'ShieldCheck',
  perf: 'Gauge',
  qa: 'Bug',
  devils_advocate: 'Scales',
  verifier: 'CheckCheck',
  product: 'Compass',
  research: 'Microscope',
  hr: 'Users',
  ceo: 'Crown',
};
