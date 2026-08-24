# Vuno — every feature, with a picture

Every image here was taken by `bun run shots` driving the real app against the
seeded database. Nothing is a mock-up. If a feature stops working, its picture
stops being produced — which is the point.

```bash
bun run dev      # one terminal
bun run shots    # another; writes docs/images/
```

Screenshots are in the **Studio** theme (the default) unless stated.

---

## Contents

1. [Signing in](#signing-in)
2. [Activity — what needs you](#activity--what-needs-you)
3. [Chats — flat, like WhatsApp](#chats--flat-like-whatsapp)
4. [Channels — threaded, like Teams](#channels--threaded-like-teams)
5. [The composer](#the-composer)
6. [What you can do to a message](#what-you-can-do-to-a-message)
7. [Calls and meetings](#calls-and-meetings)
8. [Search](#search)
9. [Work — objectives and the board](#work--objectives-and-the-board)
10. [Members — roster, org chart, review](#members--roster-org-chart-review)
11. [Ledger — what the org believes](#ledger--what-the-org-believes)
12. [Extensions — apps added to the org](#extensions--apps-added-to-the-org)
13. [Settings — skills, plugins, connectors](#settings--skills-plugins-connectors)
14. [Seven looks](#seven-looks)
15. [On a phone](#on-a-phone)

---

## Signing in

![Sign in](images/sign-in.png)

Real sessions in a database, a cookie the middleware turns away without, and a
first-run flow that claims the owner account. Nothing in the app is reachable
signed out — checked in the layout rather than per-page, because Prisma does not
run in the edge runtime and the middleware can only see that a cookie exists,
not that it names a real session.

> `src/lib/auth/`, `src/middleware.ts`, `src/app/(app)/layout.tsx`

---

## Activity — what needs you

![Activity](images/activity.png)

The screen you open first. Decisions escalated to you, gates blocked on your
approval, mentions, budgets near their cap — ordered by urgency, derived from the
spine rather than stored as a notification table.

> `src/app/(app)/activity/page.tsx`

---

## Chats — flat, like WhatsApp

![A chat reads as a stream](images/chats-flat.png)

A chat is **flat**: one stream, newest at the bottom, the way WhatsApp, Telegram
and a Teams DM work. Replies still happen — they quote what they answer and stay
in the stream, because a two-person conversation has one subject at a time and
hiding half of it behind a disclosure helps nobody.

Direct messages, group chats and team rooms live here. Your assistant is pinned
at the top.

> `src/lib/conversations.ts` — `modeFor()` decides; `src/components/vuno/message-list.tsx`

---

## Channels — threaded, like Teams

![A channel reads as posts](images/channels-threaded.png)

A channel is **threaded**: root posts in the stream, each carrying its replies
underneath, and the composer starts a *post* rather than adding a line to
whatever was said last. Somebody arriving at a busy channel sees what was
discussed, not four hundred interleaved lines.

Note in the picture: agents (Devi, Hana, Maya, Peri, Ravi) carry a **teal edge
on a squircle avatar** and a role chip; people (Kai, Mira) get a circle. Two
signals deliberately — the shape survives greyscale and a colourblind reader, the
colour is what catches the eye scrolling. Teal is the one hue no claim status
uses, so an agent can never be misread as a verdict.

`Earlier messages` walks back through history via `?before=<seq>`, so a point in
a long conversation is a link somebody can send.

> `src/lib/conversations.ts` — `listMessages()`, `attachReplies()`

---

## The composer

![The composer, with mention autocomplete](images/composer-mention.png)

Full parity with what people expect from Teams, Slack, Telegram and WhatsApp:

| | |
|---|---|
| **Attachments** | drag or pick; 25 MB, 10 per message, type-sniffed against an allowlist — a claimed type whose magic number disagrees is refused |
| **Voice notes** | `MediaRecorder`, recorded in the composer |
| **Markdown** | bold, italic, code, code fences with syntax highlighting, links, quotes, lists |
| **Mentions** | `@` autocomplete over people *and* agents — one list, because one table |
| **Emoji** | picker, and reactions |
| **Drafts** | kept per conversation in `localStorage`, so closing a tab does not lose a half-written message |

![The emoji picker](images/composer-emoji.png)

> `src/components/vuno/composer.tsx`, `src/lib/attachments/`

---

## What you can do to a message

![Message actions on hover](images/message-actions.png)

React, reply, edit, delete, pin. **Every one is an event appended to the spine**,
never an update to the message — which makes "edited" and "deleted" mean
something better than they do in a database:

- **Edited** — the original stays exactly as posted; a later event supersedes it.
  The reader sees the new text and an "edited" mark, and the org can still answer
  *what did it say when I agreed to it*.
- **Deleted** — the event stays, the body stops being served. The sequence stays
  gapless, a reply still has something to point at, and a quoted message does not
  leave a hole in the record. In **search**, it is removed outright — a search
  result *is* the body.

Who may do what: react and reply, anyone who can read the room; edit and delete,
the author and nobody else — not even the org owner, because an edit renders
under the author's name; pin, anyone, because a room where only one person may
pin is a room where nothing gets pinned.

> `src/lib/messages/actions.ts`

---

## Calls and meetings

![A two-party call in a channel](images/call.png)

Two real browsers, two real media tracks, an actual peer connection. WebRTC mesh,
in-memory signalling, cap of six.

**A call knows which room it is in**, and that is the whole design:

| | DM / group chat | Channel |
|---|---|---|
| What it is | **A ring.** You are summoning a specific person. | **A room.** It is open; you join if it concerns you. |
| Who is interrupted | The other person, wherever they are in the app | **Nobody.** It announces itself in the channel. |

A channel with two hundred members interrupting all of them because a working
group started talking is indefensible, and that is what the split prevents. The
*room* decides, not the caller.

Six is the cap because a mesh has every browser encoding one stream per other
participant. Past six needs an SFU — the one place in this codebase where a
separate service in another language would genuinely earn its keep.

![Scheduling a meeting](images/meetings.png)

A meeting is a scheduled call announced in the conversation, with a join window.

> `src/lib/calls/` — `shape.ts` holds `styleFor()`, importable by client
> components without dragging Prisma into the browser. `src/lib/meetings/`

---

## Search

![Search](images/search.png)

**⌘K from anywhere**, or `/search?q=` as a real URL that renders its results on
the server — a link to a search works with JavaScript switched off.

Messages, conversations and people. The matched words are marked with a designed
`--mark` token per theme (violet: every claim status is spoken for and teal is
the agent edge, so it is the one hue left that cannot be misread). A hit links
into history with `?before=<seq>`, so clicking it opens the conversation *at that
message* rather than at the live end.

What it will never show you: a DM you are not in, somebody else's private
thought, a team message when you are not on that team, or anything anyone
deleted.

0.2 ms for a distinctive word across 50,247 messages.

> `src/lib/search/`, `src/app/(app)/search/page.tsx`

---

## Work — objectives and the board

![Work, as a list](images/work-list.png)

An objective with success criteria, its stage on the ladder, the work items
underneath it, and the gates standing in its way.

![Work, as a board](images/work-board.png)

The board is a **view on the same objectives**, not a second destination — which
is why it is a tab inside Work rather than a rail tab of its own. Dragging a card
is a judgment: it records an event with the reason and enqueues what the
destination stage declares, exactly as the orchestrator would.

The board draws a column for every stage that is **built or occupied**. In the
picture: Filed, Defining the problem (occupied), Shipped, Killed. The ten
designed-but-unbuilt stages do not get drawn, and moving an objective into one is
refused with the reason. See [ARCHITECTURE.md](ARCHITECTURE.md#the-orchestrator-and-what-is-honestly-built).

The red blocks on the card are real gate evaluations — *Requires no falsified
claim on this project. Found 1 falsified claim.* That is the ledger and the work
graph meeting.

> `src/lib/work/board.ts`, `src/lib/orchestrator/stages.ts`, `src/lib/gates/`

---

## Members — roster, org chart, review

![The roster](images/members-roster.png)

One roster. A person and an agent are the same kind of member — same teams, same
workflow, same rows. Hire a person, install an agent, promote, demote, retire:
all the same code path, because it is all one table.

![The org chart](images/members-org.png)

The org as containment: org → departments → teams → members, with a bar per team
showing the people/agent split. Expandable, and every row names who leads it.

![Continuous review](images/members-review.png)

Claim survival, objection precision, escalation rate and spend — all derived from
the spine. **No rate at all** for a member with fewer than four settled outcomes,
because 1/1 is not a track record.

> `src/lib/members/` — `roster.ts`, `org-tree.ts`; `src/lib/review/metrics.ts`

---

## Ledger — what the org believes

![The ledger](images/ledger.png)

Every claim with its status, its provenance, and the trail of how it got there.
`asserted → believed → tested → falsified → uncertain`, moving only by an
appended `ClaimStatusChanged`.

In the **Ledger** theme a falsified claim is struck through, the way a corrected
entry is in a real ledger — the one place a visual direction earns its keep
rather than being a colourway.

> `src/lib/ledger/claims.ts`

---

## Extensions — apps added to the org

![Extensions](images/extensions.png)

Not what a member is made of — **what the org can do**. Boards, the org chart,
calls and meetings can each be added and removed, and removing one takes its
surface away: the tab stops rendering and nothing queries for it. Ledger and
Review are listed too, marked as part of the product, because a catalogue showing
only the removable half would misdescribe what is here.

The rule that keeps it from becoming a brochure: **every entry controls a surface
that visibly appears and disappears**, and each row names that surface in the
words of the navigation — "A Board view in Work", not "enables boards".

> `src/lib/apps/index.ts`, `src/app/(app)/extensions/page.tsx`

---

## Settings — skills, plugins, connectors

The same three sections Claude Code has, because they are the three real kinds of
thing and people already know the words.

![Skills](images/settings-skills.png)

A **skill** is instructions in the `SKILL.md` convention. Holding one is not a
setting: the text is put in front of the member on their next turn.

![Plugins](images/settings-plugins.png)

A **plugin** is a package that installs skills and connectors and hires whoever
uses them — all-or-nothing in a transaction. Three ship in `catalogue/`; anything
else goes in as a manifest in the same format.

![Connectors](images/settings-connectors.png)

A **connector** is an MCP server the org has dialled. **Holding the connector
*is* the permission** — there is no second permissions table to drift out of
sync. `bun run mcp:example` starts a server to point one at.

Settings is reached from the viewer menu at the foot of the rail, next to signing
out — it is administrative and rare, and it configures the members the org
already has rather than adding anything to it. That is why it is not a rail tab
and Extensions is.

> `src/lib/skills/`, `src/lib/plugins/`, `src/lib/connections/`

---

## Seven looks

Two defaults, three colourways, two directions. A **direction** is not a palette:
it changes the type and the shape language too.

| | |
|---|---|
| ![Studio](images/theme-studio.png) | **Studio** — the default. Elevated surfaces, soft shadow, violet accent. |
| ![Daylight](images/theme-daylight.png) | **Daylight** — the same design in light. |
| ![Ink](images/theme-ink.png) | **Ink** — dark neutral. |
| ![Paper](images/theme-paper.png) | **Paper** — a true light neutral; warm-leaning grey, not cream. |
| ![Warm](images/theme-warm.png) | **Warm** — light, warmer, gold accent. |
| ![Ledger](images/theme-ledger.png) | **Ledger** — a *direction*. Ruled, not boxed: zero radius, its own serif, struck-through corrections. |
| ![Console](images/theme-console.png) | **Console** — a *direction*. Hard-edged, monospace, terminal. |

Chosen from the theme menu at the foot of the rail; survives a reload.

> `src/app/globals.css`, `src/components/vuno/theme-menu.tsx`

---

## On a phone

| | |
|---|---|
| ![The list on a phone](images/phone-list.png) | ![A conversation on a phone](images/phone-conversation.png) |

A phone has room for one column, not three. When a conversation is open the list
pane steps aside for it — the list is a page you came from, not a rail you keep.
No horizontal overflow anywhere; checked by the browser suite.

---

## What is not here

Stated plainly, because a features document that only lists wins is marketing:

- **One process, one file.** No second server can share the rate-limit counters
  or the writer.
- **Calls cap at six.** Past that needs a media server.
- **No TURN relay unless you run one.** Behind a symmetric NAT a call cannot
  connect — the app says so rather than failing silently.
- **No push, no email, no mobile app.** If the tab is closed, nothing reaches you.
- **Harness keys are environment variables.** Configuring an agent means access
  to the server.
- **Ten of fifteen orchestrator stages are designed, not built.** The largest
  remaining piece of work.
- **`src/components/ui/` is 47 dead files.** The shadcn scaffold from the
  original template; only `toaster.tsx` is reachable. It is what holds 40+
  unused dependencies in `package.json`. Left in place deliberately — see
  [STACK.md](STACK.md#the-dead-scaffold).
