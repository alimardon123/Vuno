// Vuno — Event spine types
// Per ADR-0004: append-only typed events. The chat surface is a projection.

export type EventType =
  | 'MessagePosted'
  | 'ThreadReplyPosted'
  | 'MentionMade'
  | 'ObjectiveFiled'
  | 'RequirementStated'
  | 'ProposalOpened'
  | 'EvidenceAttached'
  | 'ObjectionRaised'
  | 'AlternativeProposed'
  | 'ExperimentRequested'
  | 'ExperimentCompleted'
  | 'BenchmarkReported'
  | 'RiskFlagged'
  | 'DecisionRecorded'
  | 'ClaimStatusChanged'
  | 'GateEvaluated'
  | 'GateBlocked'
  | 'GatePassed'
  | 'RoleAssigned'
  | 'EscalationOpened'
  | 'EscalationResolved'
  | 'MemberJoined'
  | 'MemberRoleChanged'
  | 'MemberRetired'
  | 'WikiSectionAuthored'
  | 'AgentThought'
  | 'SharedItem'
  | 'ReactionAdded'
  | 'ReactionRemoved'
  | 'MessageEdited'
  | 'MessageRedacted'
  | 'MessagePinned'
  | 'MessageUnpinned'
  | 'PreemptIssued'
  | 'AttentionWakeup'
  | 'MemoryUpdated'
  | 'PaProactiveNote'
  | 'AgentHandoff'
  | 'ToolCalled';

// An event is authored by a member — human or agent, the spine does not care —
// or by the runtime itself. Which kind of member it was lives on the Member
// record, not duplicated onto every row (ADR-0009).
export type ActorType = 'member' | 'system';

export type ScopeType =
  | 'channel'
  | 'decision'
  | 'project'
  | 'objective'
  | 'team'
  | 'org'
  | 'tenant';

export type Visibility = 'tenant' | 'org' | 'team' | 'private';

// Payload map — discriminated union. Each event type has its own payload shape.
export interface EventPayloadMap {
  MessagePosted: { body: string };
  ThreadReplyPosted: { body: string; parentId: string };
  MentionMade: { mentionedId: string; mentionedType: 'agent' | 'human' };
  ObjectiveFiled: {
    objectiveId: string;
    title: string;
    successCriteria: string;
    constraints?: string;
    budget?: string;
    autonomyLevel: string;
    owningDepartment?: string;
  };
  RequirementStated: { requirementId: string; text: string; objectiveId: string };
  ProposalOpened: {
    decisionId: string;
    title: string;
    body: string;
    alternatives?: Array<{ name: string; rejectedReason: string }>;
    scopeProjectId: string;
  };
  EvidenceAttached: {
    decisionId: string;
    evidenceType: 'benchmark' | 'paper' | 'incident' | 'cost_model' | 'prior_art';
    label: string;
    summary: string;
    supportsOrRefutes: 'supports' | 'refutes' | 'neutral';
    targetClaimId?: string;
  };
  ObjectionRaised: {
    decisionId: string;
    claimText: string;
    evidenceEventId?: string;
    severity: 'low' | 'medium' | 'high';
  };
  AlternativeProposed: {
    decisionId: string;
    name: string;
    body: string;
  };
  ExperimentRequested: {
    experimentId: string;
    kind: 'benchmark' | 'load_test' | 'spike' | 'fuzz' | 'failure_injection';
    purpose: string;
    targetClaimId?: string;
  };
  ExperimentCompleted: {
    experimentId: string;
    result: string;
    outcome: 'supports' | 'refutes' | 'inconclusive';
    targetClaimId?: string;
  };
  BenchmarkReported: {
    experimentId: string;
    metric: string;
    value: string;
    unit: string;
    target: string;
    passed: boolean;
    targetClaimId?: string;
  };
  RiskFlagged: {
    scopeType: 'project' | 'decision';
    scopeId: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    claimId?: string;
  };
  DecisionRecorded: {
    decisionId: string;
    outcome: 'accepted' | 'rejected' | 'falsified' | 'superseded';
    chosen: string;
    rationale: string;
    rejectedAlternatives: Array<{ name: string; reason: string }>;
  };
  ClaimStatusChanged: {
    claimId: string;
    from: ClaimStatus;
    to: ClaimStatus;
    reason: string;
    evidenceEventId?: string;
  };
  GateEvaluated: {
    gateId: string;
    name: string;
    policy: string;
    result: 'passed' | 'blocked';
    reason: string;
  };
  GateBlocked: {
    gateId: string;
    name: string;
    reason: string;
    blockingRiskIds: string[];
  };
  GatePassed: {
    gateId: string;
    name: string;
  };
  // `memberId`, not `agentId`: a person takes a role in a debate the same way an
  // agent does (ADR-0009). The role is open text because the orchestrator
  // assigns things the debate engine's five never covered — an owning
  // department, a working group — and it was writing those under this type
  // already, against a declared payload they did not match.
  RoleAssigned: {
    memberId: string;
    memberName: string;
    role: string;
    reason: string;
    decisionId?: string;
    objectiveId?: string;
  };
  EscalationOpened: {
    decisionId: string;
    from: string;
    to: string;
    reason: string;
  };
  EscalationResolved: {
    decisionId: string;
    resolution: string;
  };
  // Composition changes read the same for a person and for an agent, because
  // they are the same kind of member (ADR-0009). `AgentInstalled` had no human
  // counterpart at all: hiring a person appended nothing, so the spine recorded
  // half the org's history — the schema-level bias the parity rule exists to
  // stop.
  MemberJoined: {
    memberId: string;
    name: string;
    kind: 'human' | 'agent';
    role: string;
    teamId?: string;
    teamName?: string;
    /** Agents only: what will run them. */
    modelName?: string;
    harnessName?: string;
    /** Set when this member is somebody's assistant. */
    ownerMemberId?: string;
    ownerName?: string;
  };
  MemberRoleChanged: {
    memberId: string;
    name: string;
    from: string;
    to: string;
    teamId?: string;
    teamName?: string;
    reason: string;
  };
  MemberRetired: { memberId: string; name: string; reason: string };
  WikiSectionAuthored: { sectionId: string; title: string; body: string; scope: string };
  // An agent reached outside this org. Recorded because it is the one kind of
  // action that changes something the ledger cannot see.
  ToolCalled: {
    connectionKey: string;
    connectionName: string;
    tool: string;
    arguments: Record<string, unknown>;
    /** What came back, truncated for the log. The full result went to the model. */
    result: string;
    failed: boolean;
    durationMs: number;
  };
  AgentThought: {
    thoughtType: 'observation' | 'hypothesis' | 'conclusion' | 'question' | 'doubt';
    content: string;                    // the thought text
    topic: string;                      // what this thought is about (queryable)
    relatedEventId?: string;            // optional link to another event (graph edge)
    relatedThoughtId?: string;          // optional link to another thought (graph edge)
    visibility: 'agent' | 'team' | 'org';  // who can see this thought
  };
  SharedItem: {
    itemType: 'file' | 'report' | 'url' | 'image' | 'code' | 'data';
    title: string;
    description?: string;
    url?: string;
    content?: string;
    fileName?: string;
    mimeType?: string;
    meta?: Record<string, string>;
  };
  ReactionAdded: {
    emoji: string;           // e.g. "👍", "❤️", "🚀"
    targetEventId: string;   // which message this reaction is on
  };
  ReactionRemoved: {
    emoji: string;
    targetEventId: string;
  };
  // An edit does not change the message. The spine is append-only, so the
  // original stays exactly as it was posted and this supersedes it — which is
  // also what makes "edited" honest rather than a claim nobody can check.
  MessageEdited: {
    targetEventId: string;
    body: string;
  };
  // Deleting is redacting. The event stays, so the sequence stays gapless and
  // a reply to it still has something to point at; the body stops being served.
  MessageRedacted: {
    targetEventId: string;
  };
  MessagePinned: {
    targetEventId: string;
  };
  MessageUnpinned: {
    targetEventId: string;
  };
  PreemptIssued: {
    interruptingAgentId: string;
    interruptingAgentName: string;
    targetAgentId: string;
    targetAgentName: string;
    reason: string;           // why the interruption
    urgency: 'low' | 'medium' | 'high';  // how urgent
  };
  AttentionWakeup: {
    agentId: string;
    agentName: string;
    role: string;                          // 'security' | 'perf' | 'verifier' | 'hr' | 'architect' | 'devils_advocate'
    triggerEventId: string;                // the message event that woke this agent
    topic: string;                          // what topic matched (e.g. "security", "perf")
    matchedKeywords: string[];              // which keywords triggered the wake-up
    confidence: number;                     // 0-1 — how relevant the agent thinks this is
  };
  MemoryUpdated: {
    agentId: string;              // the personal assistant (e.g. Bob)
    agentName: string;
    ownerHumanId: string;          // the human owner (e.g. Kai)
    ownerName: string;             // owner's display name (for rendering)
    factType: 'interest' | 'focus_area' | 'sentiment' | 'preference';
    key: string;                    // e.g. "interests", "focus_areas", "current_sentiment"
    value: string;                  // the learned value (e.g. "rust", "worried")
    oldValue: string | null;        // previous value (null if new fact)
    evidenceEventId: string;        // the user message that triggered this learning
    confidence: number;             // 0-1 — how confident the PA is in this inference
  };
  PaProactiveNote: {
    agentId: string;               // the personal assistant (e.g. Bob)
    agentName: string;
    ownerHumanId: string;           // the human owner (e.g. Kai)
    ownerName: string;              // owner's display name (for rendering)
    body: string;                    // the proactive note text — weaves in learned facts
    memoryReferences: Array<{
      factType: 'interest' | 'focus_area' | 'sentiment' | 'preference';
      key: string;                   // e.g. "interests"
      value: string;                 // e.g. "Rust"
      memoryEventId: string;         // the MemoryUpdated event this references (for the 🧠 pill)
    }>;
  };
  AgentHandoff: {
    fromAgentId: string;            // the delegating agent (e.g. Bob)
    fromAgentName: string;
    fromRole: string;
    toAgentId: string;              // the target expert agent (e.g. Sid)
    toAgentName: string;
    toRole: string;                  // 'security' | 'perf' | 'architect' | ...
    request: string;                // what the sender is asking — "please review the security concern"
    contextSummary: string;          // curated context from the sender (e.g. learned facts + sentiment)
    triggerEventId: string;         // the user message that originated this chain
  };
}

export interface EventRecord<T extends EventType = EventType> {
  id: string;
  seq: number;
  type: T;
  payload: EventPayloadMap[T];
  tenantId: string;
  orgId: string;
  actorType: ActorType;
  actorMemberId?: string | null;
  /** The member whose authority the action carried, when it carried one. */
  onBehalfOfMemberId?: string | null;
  scopeType: ScopeType;
  scopeId: string;
  visibility: Visibility;
  createdAt: string;
}

// For new event inserts (system-generated; IDs and seq assigned by the spine)
export type NewEventInput<T extends EventType = EventType> = {
  type: T;
  payload: EventPayloadMap[T];
  actorType: ActorType;
  actorMemberId?: string;
  onBehalfOfMemberId?: string;
  scopeType: ScopeType;
  scopeId: string;
  visibility?: Visibility;
  /**
   * When the thing happened, when that differs from when it was recorded —
   * seeding and importing history. Ordering still comes from `seq`, which the
   * database assigns; this only sets the timestamp the UI renders.
   */
  occurredAt?: Date;
};

export const CLAIM_STATUSES = [
  'asserted',
  'believed',
  'tested',
  'falsified',
  'uncertain',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const DEBATE_STATES = [
  'draft',
  'open',
  'contested',
  'experiment_pending',
  'resolved',
  'escalated',
] as const;
export type DebateState = (typeof DEBATE_STATES)[number];

export const GATE_STATES = ['pending', 'passed', 'blocked'] as const;
export type GateState = (typeof GATE_STATES)[number];
