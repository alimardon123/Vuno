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

2. **Visibility is inherited in full, including direct messages.** Bob's readable set is
   computed at read time as *Kai's readable set*, DMs included. Computed rather than
   copied, so when Kai leaves a channel Bob loses it in the same query — no revocation
   job, no drift.

   This is a deliberate owner decision, made after the alternative was raised: an
   assistant that cannot see the conversations you are actually in cannot answer
   questions about them, and the whole value of a personal assistant is that it shares
   your context. It is stored as the scope `read:inherit_all`, granted by default — a
   scope rather than a hardcoded rule, so an organisation that later needs to narrow it
   can, without a schema change.

   Two engineering consequences, neither a re-litigation of the decision:

   - It belongs in whatever privacy copy the product ships, because other people's
     messages are inside the inherited set.
   - Read inheritance is **read only**. It grants no ability to post into a conversation
     the assistant was not summoned into, which is what rules 3 and 4 govern.

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


## Part 4 — Assistants inside a conversation

**A direct message stays a direct message.** Summoning an assistant does not convert it
into a group chat, does not change its name, its avatar, its membership or where it sits
in the sidebar. Mira and Kai are still the two people in it.

The mechanism is a distinction the platform needs anyway: **participant vs. responder.**

| | Participant | Responder |
|---|---|---|
| In the member list | yes | no |
| Conversation appears in their own sidebar | yes | no |
| Receives everything | yes | only what they are summoned into |
| Can post | any time | when `@`-mentioned |
| Changes the conversation's `kind` | yes | **no** |

Kai types `@Bob` in the DM with Mira. Bob answers **in the DM, visible to both**, as an
ordinary message event with `actorMemberId = Bob` and his assistant chip. The
conversation's `kind` stays `dm` and its participants stay `[Kai, Mira]`. Mira sees the
exchange, which the owner has explicitly said is fine and which is also the honest
outcome — a reply that changes the conversation should be visible to everyone in it.

This is how Slack apps have always behaved, and it is why it does not feel strange there.

**If you want the exchange private, ask Bob in your own DM with Bob.** That conversation
already exists and is already pinned to the top of Chats. No ephemeral mode, no
"visible only to you" state, no third rendering path — one behaviour, and an existing
surface for the private case. Same rule in channels; the DM is only where it needed
stating.
