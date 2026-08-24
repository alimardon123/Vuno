# ADR-0007: Orchestrator — a durable work runtime

Status: proposed · 2026-08-23 · supersedes the request-scoped debate script

## Context

The product promise is that you file an objective and teams of agents work it —
discussing, challenging each other, experimenting, building and testing — until the
success criteria are met, escalating to a human only for hard calls.

Today none of that can happen, for one structural reason: **all agent activity lives
inside a single HTTP request.** `POST /api/debate` is a 452-line handler that runs nine
hardcoded phases with `await sleep()` between them so it looks live. The cast is fixed
local variables (`architect`, `security`, `devilsAdvocate`, `perf`, `verifier`, `hr`).
The outcome is decided at line 359, before any agent is invoked. When the request ends,
the organisation stops existing.

There is no queue, no scheduler, no loop, no termination rule, no budget check and no
escalation path anywhere in the codebase. `Objective.autonomyLevel` and
`Objective.budget` are stored and read by nothing. `Agent.tools` is parsed for display
and never executed.

## Decision

Add a **durable orchestrator process**, separate from Next.js, that owns one loop:

```
lease next work item
  → check budget for its objective and team
  → dispatch an agent run or a sandbox tool call
  → append the resulting events to the spine
  → re-evaluate the gates whose scope those events touched
  → enqueue the next work items
  → release the lease
```

It never holds an HTTP request open. In development it is a Node worker started
alongside `next dev`; in the desktop build it is a service in the same process tree.

### Two new tables

**`WorkItem`** — `id, kind, subjectType, subjectId, objectiveId, state, priority,
runAfter, leasedBy, leaseExpiresAt, attempts, lastError, createdAt`.

Leases are what make this crash-safe: a worker that dies mid-run lets its lease expire,
and the item is picked up again rather than lost. `attempts` bounds retries so a
poisoned item escalates instead of looping forever.

**`AgentRun`** — `id, agentId, workItemId, triggerEventId, modelName, harnessName,
tokensIn, tokensOut, costCents, startedAt, finishedAt, outcome, error`.

This is what makes budgets enforceable and the HR metrics real. "Cost per resolved
decision" is currently not computable because nothing records what a run cost.

### The objective state machine

`Objective.stage` becomes an enum over the twelve-stage lifecycle in the workflow doc.
Each stage declares its entry condition, its exit gate, and the work items it enqueues.
Filing enqueues *route*; routing enqueues *define problem*; definition enqueues N
independent *propose* items deliberately spread across model families; and so on.

The four rules that make this an organisation rather than a pipeline fall out of the
state machine rather than needing separate machinery:

| Rule | How the state machine enforces it |
|---|---|
| Handoffs carry context, not just artifacts | The stage transition copies claim ids, rejected alternatives and open risks forward into the next stage's input |
| Downstream can reopen upstream | A claim moving to `falsified` enqueues a `reopen_decision` work item on the decision that rests on it |
| Experiments outrank arguments | `experiment` is a stage; debate is not a stage that can conclude on its own |
| Deadlock escalates, never loops | Round budget is a column; exhausting it appends `EscalationRaised` and the item leaves the queue |

## Alternatives rejected

**A general workflow engine (Temporal, BullMQ, LangGraph).** All of them want to own
control flow and keep their state outside our event spine. Our state machine is small,
domain-specific, and must be inspectable in the ledger — a decision's history has to be
readable as events, not as another system's internal log. A leased work-item table in
SQLite is roughly 200 lines and stays ours.

**A message broker (Redis, NATS).** The event spine already is one. Adding a broker
before there are two machines creates a second source of truth and a second ordering
problem.

**Keeping orchestration in API routes with background promises.** Next.js route handlers
have no delivery guarantee after the response is sent, no restart recovery, and are
killed by any serverless deployment. This is the failure mode we are trying to remove.

## Consequences

- Objectives keep moving when nobody is watching. This is the whole point.
- Budgets, autonomy levels and escalation become enforceable at exactly one place —
  before dispatch — rather than being sprinkled through agent prompts.
- The nine-phase script in `api/debate/route.ts` is deleted, not extended.
- Running the app now means running two processes. The setup script must hide that.
- Agent runs become concurrent, which makes ADR-0008 a prerequisite rather than a
  cleanup.
