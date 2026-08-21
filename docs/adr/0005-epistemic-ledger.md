# ADR-0005: Epistemic Ledger — Claims with Status and Provenance

**Status:** Accepted
**Date:** 2025-01-01
**Decider:** orchestrator (Z.ai Code main)

## Context

Vision §3 Layer 1: "Every claim carries `status ∈ {asserted, believed, tested, falsified, uncertain}` plus provenance — which agent, which event, which evidence. Debate is the state-transition function. A counterargument backed by a benchmark is what moves `believed → falsified`."

Vision §6 (memory architecture): four tiers (agent-private, personal-assistant, team, org-ledger). The wiki is generated from the ledger.

## Decision

### The `Claim` model

```prisma
model Claim {
  id           String   @id @default(cuid())
  tenantId     String
  orgId        String
  statement    String   // the assertion text, e.g. "p99 reads will be < 50ms at 10k concurrent"
  status       String   // 'asserted' | 'believed' | 'tested' | 'falsified' | 'uncertain'
  scopeType    String   // 'project' | 'decision' | 'objective' | 'team' | 'org'
  scopeId      String
  provenanceEventId String // the Event that originated this claim
  provenanceActorType String
  provenanceActorId  String?
  supersedesId String?  // optional: if this claim supersedes an earlier one
  evidenceIds  String   // JSON array of evidence Event IDs (BenchmarkReported, EvidenceAttached, etc.)
  contradictsIds String // JSON array of claim IDs this contradicts (auto-opens new proposals)
  statusReason String?  // human-readable reason for the latest status transition
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt  // for status transitions

  @@index([tenantId, orgId, status])
  @@index([scopeType, scopeId])
  @@index([provenanceActorId])
}
```

### Status transitions

```
asserted ──(evidence attached, no objection)──> believed
believed ──(counterargument + benchmark)──────> falsified
believed ──(benchmark confirms)────────────────> tested
asserted/believed/tested ──(uncertainty surfaces)> uncertain
uncertain ──(new evidence)──────────────────────> asserted|believed|falsified
```

Every transition is recorded as a `ClaimStatusChanged` event on the spine, referencing the claim ID. The `Claim.updatedAt` is just a read-optimization; the source of truth for "current status" is the latest `ClaimStatusChanged` event (we can recompute from events).

### Provenance

A claim's `provenanceEventId` points to the event that originated it. The ledger view can render the full chain: claim → originating event → actor → evidence events → contradicting claims.

### The wiki is generated, not maintained

A wiki page for a project is computed at render time by querying:
- All `DecisionRecorded` events scoped to the project
- All claims scoped to the project, grouped by status
- All open risks (RiskFlagged events with no contradicting evidence)
- All unresolved uncertainties

This is a server component query in Next.js — cheap, cacheable, always consistent. There is no separate `WikiPage` table. There can be hand-authored narrative sections (stored as `Event` of type `WikiSectionAuthored` for diff/replay), but the factual spine is always generated.

## Consequences

- **Pro:** The ledger is the spine; the wiki cannot drift.
- **Pro:** Time-travel = "what did we believe at seq=N?" = filter claims by their latest `ClaimStatusChanged` event with `seq <= N`.
- **Pro:** Falsification is a real state transition, not a chat message — the gate can query it.
- **Con:** SQLite's lack of arrays means `evidenceIds` and `contradictsIds` are JSON strings. We parse them in TS. Acceptable cost at v1 scale.
