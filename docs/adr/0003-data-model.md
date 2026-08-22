# ADR-0003: Data Model — Tenant → Org → Department → Team → Member → Agent

**Status:** Accepted
**Date:** 2025-01-01
**Decider:** orchestrator (Z.ai Code main)

## Context

The user explicitly requested: *"add tenant now too. So we can have multi orgs in same tenant."* The vision doc says solo-local-first in v1, but multi-tenant/multi-org capability must be in the data model from day 1 to avoid a painful migration later.

The vision also distinguishes two kinds of agents (independent vs personal-assistant) and three kinds of team members (independent agents, humans, personal assistants). Authority model: org owner (CEO), department head, team lead, member, HR/meta.

## Decision

### Hierarchy

```
Tenant (1)
  └── Organization (n)           — one tenant can host multiple orgs
        └── Department (n)
              └── Team (n)
                    └── TeamMembership (n)  — links members to teams with role
                          ├── Agent (independent or personal-assistant)
                          ├── Human
                          └── (personal assistants linked to a Human via Agent.ownerHumanId)
```

### Authority levels (enum, stored on TeamMembership.role)

- `ORG_OWNER` (CEO) — set objectives, override any decision, set budgets, approve release gates
- `DEPARTMENT_HEAD` — set department targets, allocate agents, approve within-department gates
- `TEAM_LEAD` — route work, assign debate roles, escalate, mark work ready
- `MEMBER` — propose, object, attach evidence, request experiments, block on gates
- `HR_META` — read everything; write only proposals about the org itself

### Agent kinds (enum, stored on Agent.kind)

- `INDEPENDENT` — org-owned, role-bound, autonomous; lives in teams, channels, projects; memory scope = org ledger
- `PERSONAL_ASSISTANT` — owned by one human; lives in their private chat; enters channels via @-mention; memory scope = owner's private files/history

### Member identity

A **Member** is a polymorphic concept. We model it as:

- `Agent` (with `kind` discriminator and optional `ownerHumanId` for personal assistants)
- `Human` (with optional `isOrgOwner` flag)
- `TeamMembership` is a join table linking either to a Team with a `role`

For SQLite, we use a single `Membership` polymorphic join with `memberType: 'agent' | 'human'` and `memberId` (string). Polymorphic relations in Prisma are explicit.

### v1 simplification

- v1 ships **one tenant** (seeded), **one organization** (seeded), **4 departments** (Product, Engineering, Security, HR/Meta), **4 teams** (one per dept), **~6-8 agents** across teams.
- The tenant switcher UI is stubbed (shows current tenant name; no actual switching in v1).
- The org switcher UI is stubbed (shows current org name; no actual switching in v1).
- Both become real in a later slice when more orgs are seeded.

## Consequences

- **Pro:** Multi-tenant is in the data from day 1; no migration later.
- **Pro:** Agent kinds are explicit, not prompting conventions.
- **Pro:** Authority levels are enumerable, not freeform strings.
- **Con:** Polymorphic memberships in Prisma/SQLite require explicit `memberType` discriminator field. Slightly more code, but no real cost.
- **Risk:** v1's "one org seeded" means the multi-org switcher is dark/untested UI. We mark it explicitly as "Coming in v2" in the design.
