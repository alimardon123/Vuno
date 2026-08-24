# Vuno — information architecture

Decided 2026-08-23 with the product owner. Supersedes the current five-panel left rail.

## The rule underneath everything

**A user is a human or an agent, everywhere, with no separate concept.** "Add a user to
a channel" is one operation whether you are adding Mira or Aris. Teams and departments
are addressable the same way. This single decision is what makes human–agent parity real
in the data model rather than only in the copy.

This is a **schema** rule before it is a UI rule. Today it is violated: `Claim` has a
`provenanceAgentId` and no `provenanceUserId`, `Event.actorAgentId` has a relation and an
index while `actorUserId` has neither, and `User` declares no relations at all — so a
claim made by a person loses its author and HR cannot score them. ADR-0009 merges `User`
and `Agent` into one `Member` identity and states the rule that holds the line: **any
column that can hold an agent must be able to hold a human, and the reverse.**

ADR-0009 also covers delegation. **An assistant always acts under its own name** — Bob
posts as Bob with the chip that already says whose assistant he is, so there is exactly
one way a member renders. Identity and authority are separate: when an action carries the
owner's authority (approving a gate, spending budget), that is marked on **the action** —
*Bob approved · with Kai's authority* — not on the name.

Both fields are stored on every event regardless: `actorMemberId` and
`onBehalfOfMemberId`.

Corollary for the schema: `Channel` gets a `kind` discriminator —
`dm | group | team_room | channel` — resolved once on the server. Today four components
each re-derive "is this a channel, a DM or a group chat" from `isDm` plus a nullable
`teamId`, with different logic, which is why the Channels panel currently lists
`# Aris` and `# Bob`.

## The six rail tabs

### Activity — *new*
The screen you open first. What needs you, ordered by urgency: decisions escalated to
you, gates blocked on your approval, mentions, budgets near their cap.

The workflow doc names the risk that the escalation ladder routes everything to you and
you become the bottleneck the product was meant to remove. You cannot manage that
without a place that shows it. Escalation rate is the health metric on this page.

### Chats
- Personal assistant pinned at the top, always, above every section.
- Then DMs and group chats you are in or have talked in. Nothing else. No channels, ever.
- Flat conversation with inline replies.
- **A team's default group chat appears here with a team badge** and the team avatar
  shape, so it reads as "the Engineering room" rather than as another group.
- Fixes the current bug where the Channels panel lists `# Aris` and `# Bob` — DMs wearing
  a hash.

**Calling your assistant inside a conversation.** `@Bob` anywhere and Bob answers **in
it, visible to everyone in it**, as an ordinary message with his assistant chip.
**A DM stays a DM** — summoning an assistant never converts it to a group chat, never
changes its name, avatar, membership, or sidebar position.

The mechanism is *participant vs. responder*. A responder is not in the member list,
does not get the conversation in its own sidebar, does not receive everything, and does
not change the conversation's `kind` — it answers when summoned. Exactly how Slack apps
behave, which is why it does not feel strange there.

Want an exchange private? Ask Bob in **your own DM with Bob** — already pinned to the top
of Chats. One behaviour, no ephemeral mode, no third rendering path.

An assistant inherits its owner's full read visibility, DMs included (ADR-0009 §2).


### Channels
- Channels with **named threads** (the Zulip topic model — a thread is a stable place to
  attach a long argument, not a fork that scrolls away). Best threading design in the
  category and it suits agents specifically.
- **Members are users, teams, or whole departments.** Adding a department adds everyone
  in it and keeps tracking it as people join.
- **Every team, department and the org get one default channel**, created automatically,
  non-deletable, distinguishable by an owner badge.
- A channel can be pinned to an objective, which makes its thread activity part of that
  objective's record rather than loose chatter.

### Work — *new; currently has no surface at all*
Objectives, products, services, experiments. The thing you set and then watch.

An objective page shows: current stage on the twelve-stage lifecycle, which teams are on
it, live agent runs, gates and why each is passing or blocked, budget burn, the ledger
slice for this objective, and the generated wiki overview.

Today, filing an objective is a button inside the Settings panel and there is nowhere to
go and look at the result. This is the largest missing surface in the product and it is
the one the product description centres on.

### Members — *was: HR*

**Members**, not People and not Users. "People" implies humans and this tab is half
agents. "Users" is the auth word — it reads as a sysadmin screen and collides with the
account concept. "Members" is what every chat app already calls *who is in this
workspace*, it is neutral between human and agent, and it does not collide with the
`Team` entity.

The **HR team** keeps its name. It is a real team of agents inside the org that
evaluates the org — an entity, not a tab.

- **Roster** — every member, human and agent, with role, team, and current work.
- **Hire, drop, promote, demote, install an agent** — plus assistant-to-colleague
  promotion, the mechanic nothing else in the market has.
- **Library** — see below.
- **Review** — continuous evaluation: objection precision, proposal survival,
  gate-block accuracy, cost per resolved decision, per member and per team.
- **Suggestions** — the HR agent's open proposals about the org itself (reassign, swap a
  role's model, expand or reduce autonomy, retire, hire for a gap). Each goes through
  the same debate and approval path as any other work.


### Ledger
Stays top-level — it is the differentiator and should be one click from anywhere. Every
claim with its status, transition trail, evidence and what would change it. Filterable
by objective, team, agent, status. Also appears as a scoped tab inside every objective:
same component, filtered.

## What moves, and where

| Today | Becomes |
|---|---|
| Project Wiki (top-level view, hardcoded to `findFirst()` project) | The **Overview** tab on every objective, project, product and service. Not a destination — a rendering of whatever you are looking at. |
| File Objective (button in Settings) | The primary action on **Work**. |
| Thought Graph (top-level view) | Folds into the **"Why this changed"** trace drawer, opened from any message or claim. |
| Attention Router (top-level view) | A section on each agent's settings page: **"What Aris listens for"**, editable. |
| Memory Evolution (top-level view) | **"What Bob knows about you"** inside the assistant's own profile. |
| HR / Meta metrics (top-level view) | The **Review** section of Members. |
| Org (rail tab) | A section inside Members — the tree filters the roster; it is not a destination. |
| Settings (rail tab holding views + preferences) | The avatar menu at the bottom of the rail, preferences only. |

Nine destinations become six, and every one of the six is somewhere you would go on
purpose.

## Theming

Three palettes bound to one set of semantic tokens: **graphite** (default),
**warm** (the existing cream/gold direction, kept as an option), and
**high-contrast**. Claim-status colours stay fixed across all three — they carry
meaning, not mood.


## Three more ideas, and where they land

A capability library, a Multica-style board, and a runtime panel. Each is a real need.
Each would also be a seventh, eighth and ninth rail destination — which is exactly how a
communication app stops being one. **All three fit without adding a tab.**

### Skills, connections and runtimes → one Library, inside Members

Multica gives Agents, Runtimes and Skills three separate nav items. That is an
implementation detail promoted to navigation: all three answer the same question, *what
is this agent made of*.

One **Library** section inside Members holds installed skills, MCP connections, runtimes
and agent packages, each row showing who uses it. Assignment happens on the agent's own
profile — giving Aris database access is a staffing decision, not a setting.

**Do not invent formats.** Adopt **MCP** for tools and connections and the **`SKILL.md`**
convention for skills. Both are what the harnesses we want to plug in already speak —
Buzz bridges ACP to MCP for exactly this reason, and Multica's whole pitch is supporting
23 agent CLIs. A fourth format buys nothing and taxes every future integration.

**The one thing to do now: finish the agent package manifest.** `POST /api/install`
already accepts `name, kind, role, modelName, harnessName, tools[], permissions[],
teamId` — roughly 60% of it. Add:

```
prompts          system instructions + role brief
requiresSkills   [skill ids]
requiresMcp      [server ids + required scopes]
mayBlockGates    [gate names this agent is allowed to block]
permissions      [scoped capability ids]   # already present, currently unread
evaluation       criteria HR scores this role on
version, author, provenance
```

Then every agent built internally is already a package, and a registry later is just a
place packages come from. The vision doc says this exactly: *design the package format
early so you never retrofit it; build the registry late.*

### Multica-style board → a view on Work, not a feature

Not extra — but not a task manager either. ADR-0007 introduces `WorkItem` with a state
because the orchestrator cannot function without one. **A Kanban board is that table,
drawn.** The data already exists; the board costs a component, not a subsystem. It is
also the direct answer to "I want to watch my teams work" — today there is nothing to
watch.

**The columns are member-neutral.** An earlier draft of this doc proposed
*Queued · Running · Blocked on gate · Needs you · Done* on the grounds that "agent work
has different states". That was wrong, and it was wrong in the direction that matters:
humans and agents do the same work on the same board. The states are the same states.

> **Backlog · Up next · In progress · Blocked · In review · Done**

Familiar vocabulary on purpose — both kinds of member read it the same way.

What is genuinely different from Linear or Jira is not the columns, it is two things
underneath them, and both apply identically to a human and an agent:

- **`Blocked` is typed and links to its cause.** Blocked *on a gate*, *awaiting
  approval*, *over budget*, *on a dependency* — each one clickable through to the claim,
  gate, or budget that caused it. A person's pull request is blocked by the security
  gate in exactly the way an agent's is. This is the column no tracker does well and it
  is the reason the board is worth having.
- **Every column move is an event with provenance**, not a mutable status field. The
  board is a projection of the same spine as the chat and the ledger.

**"Needs you" is a lens, not a column.** It is viewer-relative, so it cannot be a shared
board state. It becomes a filter — *Everything · Mine · My team · Needs me* — which
works the same whether "me" is you, a teammate, or your assistant acting for you.

Lives as the **Board** view on Work, beside List and Timeline. No separate identifier
scheme — `MUL-17`-style keys are polish, and a second id namespace is a real cost.

### Runtime panel → presence, not a dashboard

The information matters: is Claude Code connected, is a sandbox alive, is an agent stuck,
what is running. A dashboard is the wrong shape for it in a communication app. Every chat
app already solved this — it is called **presence**, and it sits next to the name.

**One presence vocabulary for every member**, exactly where the green dot goes today:

> **available · busy · away · offline · do not disturb**

plus an optional **activity line** underneath — *"running tests on #wal-format"*,
*"in a meeting until 3"*. Same field, same rendering, for humans and agents. The only
difference is how it gets filled: an agent's is written by the orchestrator, a human's
is set by hand or from a calendar. An agent that is thinking is *busy*; an agent blocked
on a gate is *busy* with an activity line saying so; an agent that is over budget is
*away* with a reason.

That is what makes a runtime panel unnecessary: the information a dashboard would carry
is already next to the name, in a form both kinds of member share.

| Runtime concern | Where it goes |
|---|---|
| What any member is working on now | **Activity** + presence |
| One run's logs, tokens, cost | The **"Why this changed"** drawer, from the message that spawned it |
| Harness health, keys, connection config | **Settings → Runtimes** — genuinely admin, genuinely rare |

### Net effect

The rail stays at six: **Activity · Chats · Channels · Work · Members · Ledger**.
Three capabilities added, zero destinations added.

That is the test every future feature should pass: **if it needs a new rail tab, it
probably belongs inside one that already exists.**


---

## Directions

Ink, Paper and Warm are one design language in three colourways: same type,
same density, same shapes. Two directions sit beside them, and they are
different arguments about what the product is — which is why they change the
type, the shape language and the density rather than the colours.

**Ledger — a book of record.** The org keeps a ledger, so this is what a ledger
looks like: ruled paper, set in a reading serif, generous enough to read.
No rounded corners, because ruled paper has none. Status is a marginal note
rather than a filled chip. The move that earns it: a falsified claim is struck
through the way a corrected entry is in a real one — a direction is worth
having when it makes the subject more legible, not just different.

**Console — an instrument.** The same product read as a panel you watch rather
than a document you read. Everything is monospaced, including prose, which is
the single choice that makes it feel like an instrument rather than a dark
palette. Tight, hard-edged, one amber for whatever wants you; nothing
decorative is that colour.

Both are written as a skin in `globals.css` rather than a second set of
components, and nothing in a component knows which direction is on. Tailwind v4
inlines `border-radius: 6px` into `.rounded-md` rather than referencing a
variable, so a direction that changes shape has to say so about the utilities;
that is contained to the one file. The two hooks that are not utilities —
`data-status-pill` and `data-claim-status` / `data-claim-statement` — exist
because "how status is set" and "a claim the org stopped believing" are
semantic, and a direction should be able to say something about them.
