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
  | 'AgentInstalled'
  | 'AgentRetired'
  | 'WikiSectionAuthored'
  | 'AgentThought';

export type ActorType = 'agent' | 'human' | 'system';

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
  RoleAssigned: {
    decisionId: string;
    role: 'reviewer' | 'devils_advocate' | 'domain_expert' | 'verifier' | 'proposer';
    agentId: string;
    agentName: string;
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
  AgentInstalled: {
    agentId: string;
    name: string;
    role: string;
    kind: 'independent' | 'personal_assistant';
    modelName: string;
    harnessName: string;
    teamId?: string;
    teamName?: string;
  };
  AgentRetired: { agentId: string; reason: string };
  WikiSectionAuthored: { sectionId: string; title: string; body: string; scope: string };
  AgentThought: {
    thoughtType: 'observation' | 'hypothesis' | 'conclusion' | 'question' | 'doubt';
    content: string;                    // the thought text
    topic: string;                      // what this thought is about (queryable)
    relatedEventId?: string;            // optional link to another event (graph edge)
    relatedThoughtId?: string;          // optional link to another thought (graph edge)
    visibility: 'agent' | 'team' | 'org';  // who can see this thought
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
  actorAgentId?: string | null;
  actorUserId?: string | null;
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
  actorAgentId?: string;
  actorUserId?: string;
  scopeType: ScopeType;
  scopeId: string;
  visibility?: Visibility;
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
