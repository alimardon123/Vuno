# ADR-0004: Event Spine — Append-Only Typed Events

**Status:** Accepted
**Date:** 2025-01-01
**Decider:** orchestrator (Z.ai Code main)

## Context

Vision §3 Layer 1: "Every occurrence is an append-only typed event, never a mutable row: `ProposalOpened`, `EvidenceAttached`, `ObjectionRaised`, `BenchmarkReported`, `RiskFlagged`, `DecisionRecorded`, `GateEvaluated`. The chat UI is a *projection* of this log, not the source of truth. This buys replay, audit, and time-travel for free."

## Decision

### Storage

A single `Event` table. Append-only. **No UPDATE, no DELETE.** Enforced at the Prisma layer (we never call `db.event.update` or `db.event.delete` from application code).

```prisma
model Event {
  id          String   @id @default(cuid())
  seq         Int      @unique           // monotonic, for replay ordering
  type        String                     // discriminated union key
  payload     String                     // JSON-encoded, typed via TS
  tenantId    String
  orgId       String
  actorType   String                     // 'agent' | 'human' | 'system'
  actorId     String?
  scopeType   String                     // 'channel' | 'decision' | 'project' | 'team' | 'org' | 'tenant'
  scopeId     String
  visibility  String    @default("tenant") // 'tenant' | 'org' | 'team' | 'private'
  createdAt   DateTime @default(now())

  @@index([tenantId, orgId, scopeType, scopeId, seq])
  @@index([type, createdAt])
}
```

### TypeScript discriminated union

```typescript
// src/lib/events/types.ts

export type EventType =
  | 'ProposalOpened'
  | 'EvidenceAttached'
  | 'ObjectionRaised'
  | 'AlternativeProposed'
  | 'BenchmarkReported'
  | 'RiskFlagged'
  | 'DecisionRecorded'
  | 'GateEvaluated'
  | 'MessagePosted'           // chat message
  | 'ThreadReplyPosted'
  | 'MentionMade'
  | 'ObjectiveFiled'
  | 'RequirementStated'
  | 'ExperimentRequested'
  | 'ExperimentCompleted'
  | 'ClaimStatusChanged'      // the state-transition of the ledger
  | 'AgentInstalled'
  | 'AgentRetired'
  | 'RoleAssigned'            // for debate roles: reviewer, devil's advocate, etc.
  | 'GateBlocked'
  | 'GatePassed'
  | 'EscalationOpened'
  | 'EscalationResolved';

export interface EventRecord<T extends EventType = EventType> {
  id: string;
  seq: number;
  type: T;
  payload: EventPayloadMap[T];
  tenantId: string;
  orgId: string;
  actorType: 'agent' | 'human' | 'system';
  actorId?: string;
  scopeType: 'channel' | 'decision' | 'project' | 'team' | 'org' | 'tenant';
  scopeId: string;
  visibility: 'tenant' | 'org' | 'team' | 'private';
  createdAt: string;
}

// EventPayloadMap is a mapped type over specific payload shapes per event type.
```

### Projections

The chat surface queries events by `scopeType='channel'` and renders them as messages. The decision page queries events by `scopeType='decision'` and renders them as anchored discussion. The ledger view queries events of certain types (`ProposalOpened`, `EvidenceAttached`, `BenchmarkReported`, `ClaimStatusChanged`, `DecisionRecorded`) and projects them into claim rows.

### Replay

`GET /api/replay?scopeType=channel&scopeId=<id>&fromSeq=0` returns the event slice. The frontend can rebuild any view from scratch by replaying from `seq=0`.

## Consequences

- **Pro:** True audit trail. Time-travel = "show me the state at seq=N" = filter `seq <= N`.
- **Pro:** The chat is genuinely a projection — we can rebuild it from events. This is a load-bearing demo of the thesis.
- **Con:** Schema migrations are harder — adding a new event type means updating the TS union, not just the DB. Acceptable cost.
- **Con:** Soft state (like "is this proposal currently in `believed` state?") must be derived. We derive it from the latest `ClaimStatusChanged` event affecting the relevant claim.
