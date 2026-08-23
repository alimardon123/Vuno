// Vuno — Projections
// The chat surface and the ledger view are projections of the event spine.

import type { EventRecord, EventType, ClaimStatus } from './types';

// ─── Chat projection ────────────────────────────────────────────────────────
// A "chat message" is any event scoped to a channel that should render as a
// message in the chat UI. This includes MessagePosted and the typed records
// (ProposalOpened, BenchmarkReported, etc.) that have a "renders like a message"
// contract per the design system.

export const TYPED_MESSAGE_EVENTS: EventType[] = [
  'MessagePosted',
  'ThreadReplyPosted',
  'ObjectiveFiled',
  'ProposalOpened',
  'EvidenceAttached',
  'ObjectionRaised',
  'AlternativeProposed',
  'ExperimentRequested',
  'ExperimentCompleted',
  'BenchmarkReported',
  'RiskFlagged',
  'DecisionRecorded',
  'ClaimStatusChanged',
  'GateBlocked',
  'GatePassed',
  'RoleAssigned',
  'AgentInstalled',
  'AgentRetired',
  'AgentThought',
  'SharedItem',
  'ReactionAdded',
  'PreemptIssued',
  'AttentionWakeup',
  'MemoryUpdated',
  'PaProactiveNote',
  'AgentHandoff',
];

export interface ChatMessageProjection {
  id: string;
  seq: number;
  type: EventType;
  payload: EventRecord['payload'];
  actorType: 'agent' | 'human' | 'system';
  actorAgentId?: string;
  actorUserId?: string;
  // Carried through so a message can be traced back to what it was about.
  scopeType: EventRecord['scopeType'];
  scopeId: string;
  createdAt: string;
  // type-label text for rendering, e.g. "PROPOSAL" or "BENCHMARK REPORT"
  typeLabel?: string;
  // status hint for the left-border accent, if applicable
  statusHint?: ClaimStatus | 'blocked' | 'passed';
}

const TYPE_LABELS: Partial<Record<EventType, string>> = {
  MessagePosted: '',
  ThreadReplyPosted: 'REPLY',
  ObjectiveFiled: 'OBJECTIVE FILED',
  ProposalOpened: 'PROPOSAL',
  EvidenceAttached: 'EVIDENCE',
  ObjectionRaised: 'OBJECTION',
  AlternativeProposed: 'ALTERNATIVE',
  ExperimentRequested: 'EXPERIMENT REQUESTED',
  ExperimentCompleted: 'EXPERIMENT COMPLETED',
  BenchmarkReported: 'BENCHMARK REPORT',
  RiskFlagged: 'RISK FLAGGED',
  DecisionRecorded: 'DECISION RECORDED',
  ClaimStatusChanged: 'CLAIM STATUS',
  GateBlocked: 'GATE BLOCKED',
  GatePassed: 'GATE PASSED',
  RoleAssigned: 'ROLE ASSIGNED',
  AgentInstalled: 'AGENT INSTALLED',
  AgentRetired: 'AGENT RETIRED',
  AgentThought: 'THOUGHT',
  SharedItem: 'SHARED',
  ReactionAdded: 'REACTION',
  PreemptIssued: 'PREEMPT',
  AttentionWakeup: 'ATTENTION',
  MemoryUpdated: 'LEARNED',
  PaProactiveNote: 'PROACTIVE',
  AgentHandoff: 'HANDOFF',
};

const STATUS_HINTS: Partial<Record<EventType, ClaimStatus | 'blocked' | 'passed'>> = {
  ProposalOpened: 'believed',
  EvidenceAttached: 'asserted',
  ObjectionRaised: 'asserted',
  BenchmarkReported: 'tested',
  DecisionRecorded: 'falsified',
  ClaimStatusChanged: 'uncertain',
  GateBlocked: 'blocked',
  GatePassed: 'passed',
};

export function projectChatMessages(events: EventRecord[]): ChatMessageProjection[] {
  return events
    .filter((e) => TYPED_MESSAGE_EVENTS.includes(e.type))
    .map((e) => ({
      id: e.id,
      seq: e.seq,
      type: e.type,
      payload: e.payload,
      actorType: e.actorType,
      scopeType: e.scopeType,
      scopeId: e.scopeId,
      actorAgentId: e.actorAgentId ?? undefined,
      actorUserId: e.actorUserId ?? undefined,
      createdAt: e.createdAt,
      typeLabel: TYPE_LABELS[e.type],
      statusHint: STATUS_HINTS[e.type],
    }));
}

// ─── Ledger projection ───────────────────────────────────────────────────────
// Derive current claim states from events. The source of truth is the latest
// ClaimStatusChanged event per claim. If no ClaimStatusChanged exists, the
// status is whatever the claim was created with (recorded in the Claim table).

export interface LedgerEntry {
  claimId: string;
  statement: string;
  status: ClaimStatus;
  scopeType: string;
  scopeId: string;
  provenanceEventId: string;
  provenanceActorType: string;
  provenanceAgentId?: string;
  evidenceCount: number;
  contradictsCount: number;
  lastTransitionSeq: number;
  lastTransitionAt: string;
  statusReason?: string;
}

// Build a map of claimId → latest ClaimStatusChanged event
export function deriveLatestStatusTransitions(
  events: EventRecord[],
): Map<string, { to: ClaimStatus; from: ClaimStatus; reason: string; seq: number; createdAt: string; evidenceEventId?: string }> {
  const latest = new Map<string, { to: ClaimStatus; from: ClaimStatus; reason: string; seq: number; createdAt: string; evidenceEventId?: string }>();
  for (const e of events) {
    if (e.type !== 'ClaimStatusChanged') continue;
    const p = e.payload as { claimId: string; from: ClaimStatus; to: ClaimStatus; reason: string; evidenceEventId?: string };
    const existing = latest.get(p.claimId);
    if (!existing || e.seq > existing.seq) {
      latest.set(p.claimId, {
        to: p.to,
        from: p.from,
        reason: p.reason,
        seq: e.seq,
        createdAt: e.createdAt,
        evidenceEventId: p.evidenceEventId,
      });
    }
  }
  return latest;
}
