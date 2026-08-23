# Vuno — information architecture

Decided 2026-08-23 with the product owner. Supersedes the current five-panel left rail.

## The rule underneath everything

**A user is a human or an agent, everywhere, with no separate concept.** "Add a user to
a channel" is one operation whether you are adding Mira or Aris. Teams and departments
are addressable the same way. This single decision is what makes human–agent parity real
in the data model rather than only in the copy.

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

### People — *was: HR*
Not called HR in the interface: it manages humans and agents equally, and "HR" names a
department rather than a thing you do. The HR agent keeps its name as the thing that
does the evaluating.

- **Roster** — every user, human and agent, with role, team, current work.
- **Hire, drop, promote, demote, install an agent** — plus assistant-to-colleague
  promotion, the mechanic nothing else in the market has.
- **Library** — see below.
- **Review** — continuous evaluation: objection precision, proposal survival,
  gate-block accuracy, cost per resolved decision, per agent and per team.
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

**Do not copy Linear's columns.** *Backlog · Todo · In Progress · In Review · Done*
describes a human workflow. Agent work has different states, and they are the ones you
need to see:

> **Queued · Running · Blocked on gate · Needs you · Done**

*Blocked on gate* and *Needs you* exist in no issue tracker and are the entire reason to
look at the board.

**One rule: the board is never a second source of truth.** Cards are created by the
state machine, not typed by hand. Dragging a card is an *instruction to the
orchestrator* — reprioritise, unblock, take it back — which appends an event. It is not
a status edit the orchestrator then contradicts. A human may add a card; it becomes a
work item like any other.

Lives as the **Board** view on Work, beside List and Timeline. No separate identifier
scheme — `MUL-17`-style keys are polish, and a second id namespace is a real cost.

### Runtime panel → presence, not a dashboard

The information matters: is Claude Code connected, is a sandbox alive, is an agent stuck,
what is running. A dashboard is the wrong shape for it in a communication app. Every chat
app already solved this — it is called **presence**, and it sits next to the name.

Give agents a real presence vocabulary, exactly where a green dot goes today:

> **idle · thinking · running `<tool>` · blocked on gate · over budget**

That does most of what a runtime panel does, inside the metaphor rather than beside it,
and it is the detail that makes the app feel alive rather than instrumented.

| Runtime concern | Where it goes |
|---|---|
| What is running right now | **Activity** + agent presence |
| One run's logs, tokens, cost | The **"Why this changed"** drawer, from the message that spawned it |
| Harness health, keys, connection config | **Settings → Runtimes** — genuinely admin, genuinely rare |

### Net effect

The rail stays at six: **Activity · Chats · Channels · Work · Members · Ledger**.
Three capabilities added, zero destinations added.

That is the test every future feature should pass: **if it needs a new rail tab, it
probably belongs inside one that already exists.**
