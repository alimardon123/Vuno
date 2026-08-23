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
| HR / Meta metrics (top-level view) | The **Review** section of People. |
| Org (rail tab) | A section inside People — the tree filters the roster; it is not a destination. |
| Settings (rail tab holding views + preferences) | The avatar menu at the bottom of the rail, preferences only. |

Nine destinations become six, and every one of the six is somewhere you would go on
purpose.

## Theming

Three palettes bound to one set of semantic tokens: **graphite** (default),
**warm** (the existing cream/gold direction, kept as an option), and
**high-contrast**. Claim-status colours stay fixed across all three — they carry
meaning, not mood.
