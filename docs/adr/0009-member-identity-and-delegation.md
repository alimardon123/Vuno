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

1. **An assistant always acts under its own name.** Bob posts as **Bob**, everywhere,
   with the chip that already says whose assistant he is. That chip carries the
   ownership chain, so nothing is hidden, and it means there is exactly one way a member
   renders — no second display mode where an agent wears its owner's name. It is also
   simply true: Bob produced the tokens.

   Identity and authority are separate things, and only identity belongs on the name.
   When an action *carries* the owner's authority — approving a gate, spending budget,
   committing to a decision — that is a property of **the action**, and it is marked
   there:

   | What happened | Renders as |
   |---|---|
   | Kai posts | **Kai** |
   | Bob posts | **Bob** · `Kai's assistant` |
   | Bob approves a gate under delegation | **Bob** approved · `with Kai's authority` |

   Both fields are still stored on every event and neither is ever overwritten:
   `actorMemberId = Bob`, `onBehalfOfMemberId = Kai`. The display just stops trying to
   merge them. Most messages need no authority marker at all; the consequential ones
   carry it where a reader is actually looking for it.

2. **Visibility is inherited, not copied — but private conversations are carved out.**
   Bob's readable set is computed at read time as *Kai's readable set ∩ Bob's granted
   scopes*. When Kai leaves a channel, Bob loses it in the same query — no revocation
   job, no drift. Copying grants at delegation time produces stale access, which is a
   security bug that only surfaces months later.

   **The carve-out matters.** Applied naively, inheritance would give Bob every direct
   message Kai has ever received. Mira wrote to *Kai* in confidence, not to Kai's agent,
   and she never agreed to the delegation. So **direct messages and private group chats
   are excluded from inherited visibility by default.** Bob gets access to one only by
   an explicit per-conversation grant from Kai — and when that grant is made, **the other
   participants see that Bob has been added.** Never silently. See §4.

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


## Part 4 — Assistants in private conversations

A direct message is a two-party space, so summoning a third party into it is genuinely
awkward. The awkwardness is real because "call my assistant in here" actually means
three different things, and collapsing them is what makes it feel wrong.

**Mode 1 — Private aside. The default.** Kai `@`-mentions Bob inside the DM with Mira.
Bob answers **visible to Kai only**, marked *"Only you can see this"* — the same
ephemeral-response mechanism Slack has used for app replies for a decade. Bob does not
join the conversation. Mira sees nothing, not even that Bob was asked. This covers most
of what you actually want: *"Bob, what did we agree with Mira last quarter?"* is not
something to broadcast.

The composer shows the ephemeral state **before** you send, so there is never a surprise
about who is about to see it.

**Mode 2 — Bring it into the room.** Bob's private answer carries a *Share to
conversation* action. One click posts it into the DM, attributed to Bob with his
assistant chip, visible to both. Explicit, reversible in the sense that you chose it,
and it keeps the default safe.

**Mode 3 — Bob joins properly.** Kai adds Bob as a participant. The conversation becomes
a three-member group chat and Bob is a full member of it — which is the honest
representation, and it is why *Chats* holds DMs and group chats under one model.

Two rules on joining, both about Mira rather than Bob:

- **Bob sees forward, not backward.** He gets the conversation from the moment he joins.
  History before that requires Kai to share specific messages, deliberately.
- **Mira is told.** A system line in the conversation: *"Kai added Bob (Kai's
  assistant)."* Adding an agent that can read what you write is not a silent act.

The same three modes work in any conversation, including channels. DMs are only where
the distinction is load-bearing, because a channel already has an audience and a DM does
not.
