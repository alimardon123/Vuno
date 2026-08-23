# ADR-0009: One member identity, and delegated action

Status: proposed · 2026-08-23 · amends ADR-0003 (data model) and ADR-0006 (agents)

## Context

The product requires that humans and agents are **both first-class members of the same
organisation**, on the same teams, with the same workflow and the same capabilities —
agents may do a few extra things, but nothing a human does is unavailable to an agent
and nothing an agent does is unavailable to a human. Both write to the ledger. Both are
evaluated by HR.

**The current schema contradicts this in four places.** Not in the copy — in the columns.

| | Agents | Humans |
|---|---|---|
| Relation from `Event` | `actorAgent Agent? @relation("ActorAgent")` | `actorUserId String?` — no relation |
| Index on the actor column | `@@index([actorAgentId])` | none |
| Provenance on `Claim` | `provenanceAgentId` + relation + index | **no `provenanceUserId` at all** |
| Relations declared on the model | `events`, `claims` | none |

The consequences are concrete:

- **A claim made by a human loses its author.** `Claim` records
  `provenanceActorType: 'human'` and then has nowhere to put *which* human. HR cannot
  compute objection precision for a person, because the ledger does not know who they
  were. This directly defeats "both human and agent events are written to the ledger and
  analysed by HR."
- **"Everything Aris did" is an index hit; "everything Mira did" is a table scan.**
- `Membership.memberId` is a bare `String` with a `memberType` discriminator, so there
  is no referential integrity in either direction.

A second requirement, not yet modelled at all: **a personal assistant must be able to
act on its owner's behalf, with the owner's visibility**, when the owner grants it.

## Decision

### Part 1 — `Member` is the single identity

```
Member         id, tenantId, orgId, kind('human'|'agent'), displayName, handle,
               avatar, status('active'|'suspended'|'retired'),
               presenceState, presenceActivity, createdAt

HumanProfile   memberId(PK,FK), email, timezone, isOrgOwner
AgentProfile   memberId(PK,FK), role, modelName, harnessName, tools, permissions,
               ownerMemberId (null unless personal assistant), packageId, version
```

Everything that referenced a user *or* an agent now references a member:

- `Event.actorMemberId` — one FK, indexed. `actorType` survives only to mark `'system'`.
- `Claim.provenanceMemberId` — one FK, indexed. Humans get provenance.
- `Membership.memberId` — a real foreign key, discriminator deleted.
- Assignment, mentions, presence, channel membership, reactions, reviewers: one type.

**The rule that holds the line:** any column that can hold an agent must be able to hold
a human, and the reverse. If a feature needs an `agentId`, the design is wrong. This is
the schema-level statement of the UI-level rule already in `IA-NAVIGATION.md` — a user
is a human or an agent, everywhere, with no separate concept.

### Part 2 — Delegation

```
Delegation     id, principalMemberId, agentMemberId, scopes[],
               budgetCapCents, expiresAt, createdAt, revokedAt
```

Four rules, all load-bearing:

1. **Two fields, and the owner is the one that leads.** An event produced under
   delegation stores both: `actorMemberId = Bob` (who executed) and
   `onBehalfOfMemberId = Kai` (whose authority). Neither is ever overwritten. But the
   *display* identity is the accountable party, not the executor:

   > **Kai** `via Bob`

   The reasoning: when Kai lends Bob his authority, the socially relevant fact is that
   this is *Kai's* position and Kai is accountable for it. Leading with "Bob" makes
   people mentally discount delegated work — which both defeats the point of delegating
   and quietly makes it second-class. Git has had exactly this two-field model for
   twenty years: `Author` and `Committer` are both recorded, `git log` shows the author,
   and nobody finds that confusing.

   Three properties the marker must have, all non-negotiable:

   - **Always visible.** A chip on the name line, not a tooltip and not a hover state —
     hover does not exist on touch, and an invisible distinction is not a distinction.
   - **Legible in a dense list.** It has to survive at 12px in a sidebar preview, so it
     is a short chip plus an avatar badge in the corner slot where Slack puts its app
     marker, not a sentence.
   - **Not suppressible.** No setting hides it. The moment it can be turned off, the
     guarantee is gone.

   The chip is clickable, and opens the delegation: which scopes were granted, when,
   what this specific action did, and a revoke control.

1b. **An assistant acting on its own initiative is itself, not its owner.** If Bob posts
   because he noticed a failing benchmark — rather than because Kai asked, or within a
   standing grant Kai gave — then this is not Kai's position and Kai may not have seen
   it. Displaying "Kai" there would be a lie.

   No extra field is needed: `onBehalfOfMemberId` is set **only** for delegated acts. When
   it is null, Bob is the sole actor and renders plainly as **Bob**. So:

   | What happened | Renders as |
   |---|---|
   | Kai posts | **Kai** |
   | Bob posts under delegation | **Kai** `via Bob` |
   | Bob posts on his own initiative | **Bob** |

1c. **High-stakes events elevate the attribution.** For anything that changes a gate,
   moves a claim's status, or spends budget, the chip is promoted to a full line rather
   than a subtle marker — those are exactly the actions where you most need to see that
   it was delegated. And in the owner's own **Activity**, delegated actions always render
   executor-first (*Bob did X for you*), because that view exists precisely to audit what
   was done in your name.

2. **Visibility is inherited, not copied.** Bob's readable set is computed at read time
   as *Kai's readable set ∩ Bob's granted scopes*. When Kai leaves a channel, Bob loses
   it in the same query — no revocation job, no drift. Copying grants at delegation time
   produces stale access, which is a security bug that only shows up months later.

3. **Scopes are explicit and revocable**, not one boolean: `post`, `react`, `propose`,
   `object`, `attach_evidence`, `run_experiment`, `write_code`, `spend:<cap>`,
   `approve_gate:<class>`.

4. **Approval scopes are opt-in and default off.** If an assistant can approve gates as
   its owner, then "escalates to a human" quietly becomes "escalates to the human's
   agent", and the human-in-the-loop property the entire autonomy model depends on
   evaporates. So: delegable only per gate class, only by explicit grant, always
   dual-attributed, and **the escalation still appears in the owner's Activity even when
   the assistant handled it**. The owner should be able to see, after the fact, every
   decision made in their name.

### Part 3 — HR symmetry

HR reads the ledger, and once the ledger is member-neutral HR evaluates humans and
agents by construction — no separate code path. Proposal *effects* differ by kind as a
natural consequence (you cannot swap a human's model, or retire one), which is not an
asymmetry in the platform.

One rule added: **an HR proposal about a member is visible to that member by default.**
Evaluation a person cannot see is surveillance, not performance management. Applying the
same rule to agents costs nothing and keeps the mechanism uniform.

## Consequences

- A migration merging `User` and `Agent` into `Member`. Moderate work now; far more
  expensive after the shell rebuild, which is why it lands in P0/P1 rather than later.
- `AgentRun` as proposed in ADR-0007 becomes **`WorkSession`** — universal
  (`memberId, workItemId, startedAt, endedAt, outcome, costCents, durationMs`) — with an
  optional agent-execution detail (`model, harness, tokensIn, tokensOut`). Cost per
  resolved decision then means something for both kinds of member.
- Presence becomes one field with one vocabulary for everyone.
- Personal assistants become genuinely useful without becoming unauditable.
