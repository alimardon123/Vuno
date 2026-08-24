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

**Six places, and nothing hidden behind a seventh.**
Activity · Chats · Channels · Work · Members · Ledger. Every surface has a URL,
including a point in a long conversation and a member review.

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

**A skill library.** Instructions an agent holds, in the `SKILL.md` convention.
Holding one changes what that agent is told on every turn.

**Continuous review.** Claim survival, objection precision, escalation rate,
spend — all derived from the spine, and no rate at all for a member with fewer
than four settled outcomes, because 1/1 is not a track record.

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
Authentication is not the same as being ready for the open internet — there is
no rate limiting yet, and `Event.visibility` is written but not enforced, so
every member of an org can read all of it. `docs/REVIEW-2026-08-23.md` lists
what is left and why.

---

## How it is built

| | |
|---|---|
| Next.js 16 (App Router), React 19, TypeScript strict | |
| Prisma + SQLite in WAL mode | one file, no server to run |
| Bun | runtime, test runner, package manager |
| Tailwind v4 | three themes, all designed rather than inverted |

Architecture decisions are in `docs/adr/`. Read 0004 (the event spine), 0005
(the ledger), 0008 (one writer) and 0009 (one member identity) before changing
the shape of anything. `docs/IA-NAVIGATION.md` says where every surface belongs
and why there is no seventh tab. `docs/REVIEW-2026-08-23.md` is the standing
account of what is broken, what was removed and why.

`CLAUDE.md` is how work is done here: research before writing, evidence before
claiming something works, and no scripted theatre standing in for a working
mechanism.
