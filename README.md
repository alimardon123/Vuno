# Vuno

A communication app on the surface. A working organisation underneath.

People and AI agents are members of the same org, on the same teams, with the
same workflow. You set an objective; the org routes it, forms a working group,
argues about it with evidence, and records what it believes — and what would
change its mind — on a ledger that release gates read from.

```bash
bun run setup    # install, migrate, seed — one command, fresh clone
bun run dev      # the app and the orchestrator
```

Then open http://localhost:3000. Nothing else to configure to look around.

---

## What is actually here

**Seven places, and nothing hidden behind an eighth.**
Activity · Chats · Channels · Work · Members · Extensions · Ledger. Every
surface has a URL, including a point in a long conversation and a member
review.

**An append-only event spine.** Every message, objection, benchmark and role
change is an event with a monotonic sequence. The chat you read is a projection
of it, one writer owns it, and replaying it from zero reproduces what the app
shows — there is a test that asserts exactly that.

**An epistemic ledger.** A claim carries a status (`asserted`, `believed`,
`tested`, `falsified`, `uncertain`) and the evidence that moved it. Status
*transitions*; claims are never re-created. Illegal moves are refused with a
message saying what is legal.

**Gates that are queries, not flags.** A release gate holds a predicate over the
ledger. When it blocks it says what blocked it — "Requires no falsified claim on
this project. Found 1 falsified claim." — and names the claim.

**A durable orchestrator.** Work is leased, not locked, so a crashed worker's
item comes back on its own. Every run records who made it, how long it took and
what it cost.

**Agents that run on a real model.** `@peri` in a conversation queues a turn for
Peri. It runs in the orchestrator, its output goes through a validation boundary
before anything reaches the spine, and what it cost is recorded. With no model
configured it fails on the first attempt saying which environment variable to
set — it never falls back to something that sounds like an answer.

**Settings — skills, plugins and connectors.** The same three sections Claude
Code has, because they are the three real kinds of thing. A *skill* is
instructions in the `SKILL.md` convention, and holding one changes what that
member is told on their next turn. A *connector* is an MCP server the org has
added, and holding one **is** the permission to call it — there is no second
permission list to drift out of step. A *plugin* installs both and hires
whoever uses them, which is what makes the other two useful: a skill nobody
holds and a connector nobody may call are equally inert.

Three plugins ship in `catalogue/`. Anything else goes in as a manifest, in the
same format the catalogue files use. `bun run mcp:example` starts an MCP server
to point a connector at, for anyone who has not got one yet.

**Extensions — apps added to the org.** A different question: not what a member
is made of, but what the org can do. Boards, the org chart, calls and meetings
can each be added and removed, and removing one takes its surface away. Ledger
and Review are listed too, marked as part of the product, because a catalogue
that showed only the removable half would misdescribe what is here.

**A channel reads as posts; a chat reads as a stream.** A channel is threaded —
each post carries its replies under it, and the composer starts a post rather
than adding a line to whatever was said last. A chat is flat, the way WhatsApp
and a Teams DM are, and a reply quotes what it answers inline.

**Calls that know which room they are in.** A call in a DM rings the other
person wherever they are in the app. A call in a channel rings nobody — it is a
room that is open, and you join it if it concerns you. Six is the cap either
way: a mesh has every browser encoding one stream per other participant.

**Continuous review.** Claim survival, objection precision, escalation rate,
spend — all derived from the spine, and no rate at all for a member with fewer
than four settled outcomes, because 1/1 is not a track record.

**Two design directions, not five palettes.** Ink, Paper and Warm are one design
language in three colourways. *Ledger* and *Console* are different arguments
about what this is: Ledger is a book of record — a reading serif, ruled lines,
no rounded corners, and a falsified claim struck through the way a corrected
entry is. Console is an instrument — everything monospaced including prose,
hard edges, one amber for whatever wants you. Pick one from the theme menu in
the rail.

---

## Giving the agents a model

Without one, everything deterministic still works: objectives route, working
groups form, gates evaluate, claims transition. Agents cannot think.

In `.env`:

```bash
# Hosted — console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# Or local, no key and no account:
#   ollama pull llama3.2
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Then set an agent's harness to `anthropic` or `ollama` in Members → Roster →
Install an agent. Existing agents default to `anthropic`.

---

## Commands

| | |
|---|---|
| `bun run setup` | install, apply migrations, seed if the database is empty |
| `bun run dev` | the app and the orchestrator together |
| `bun run check` | typecheck, lint, tests — fast, no browser |
| `bun run smoke` | drives a real browser against a running server |
| `bun run build` && `bun run start` | production build and serve |
| `bun run seed` | replace the database with the sample org |
| `bun run db:migrate` | create a migration from a schema change |
| `bun run export` | the whole org as JSON, on stdout |
| `bun run export --backup` | a copy of the database file, next to it |

`bun run setup` fills an empty database and leaves a used one alone. `bun run
seed` clears first — that is its job.

---

## Signing in

The first time you open it, nobody has a password yet — the page offers to set
one, and that claims the org owner's account. After that it asks for an email
and a password like anything else. Sessions are rows, so signing out actually
signs you out, and retiring a member ends their access immediately rather than
in thirty days.

Nothing is reachable signed out: a page redirects, an API call gets a 401. And
being signed in is not the same as being in a conversation — a DM is readable
by the people in it and nobody else, which includes not being able to post into
one or subscribe to it. An assistant reads whatever its owner reads.

## Getting the org out

Everything is one SQLite file, which is worth knowing before you need to know
it. `bun run export --backup` checkpoints the write-ahead log and copies it —
that is what you restore from. `bun run export` writes the whole org as JSON on
stdout, events first, for reading or moving somewhere that is not SQLite;
password hashes and sessions are deliberately left out of it.

`bun run start` still binds 127.0.0.1 and warns if you point it elsewhere.
Authentication is not the same as being ready for the open internet. Writes are
limited to sixty a minute per member, but the counters live in one process, so a
second server would not share them. `docs/REVIEW-2026-08-23.md` lists what is
left and why.

---

## How it is built

| | |
|---|---|
| Next.js 16 (App Router), React 19, TypeScript strict | |
| Prisma + SQLite in WAL mode | one file, no server to run |
| Bun | runtime, test runner, package manager |
| Tailwind v4 | seven looks: two defaults, three colourways, two directions |

Architecture decisions are in `docs/adr/`. Read 0004 (the event spine), 0005
(the ledger), 0008 (one writer) and 0009 (one member identity) before changing
the shape of anything. `docs/IA-NAVIGATION.md` says where every surface belongs
and why there are seven tabs and not nine — and why Settings is not one of
them. `docs/REVIEW-2026-08-23.md` is the standing
account of what is broken, what was removed and why.

`CLAUDE.md` is how work is done here: research before writing, evidence before
claiming something works, and no scripted theatre standing in for a working
mechanism.
