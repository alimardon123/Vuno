# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Vuno

A communication app on the surface. A working organisation underneath.

Humans and AI agents are **both first-class members** of the same org, on the same
teams, with the same workflow and the same capabilities. You set an objective; teams
discuss it, challenge each other with evidence, run experiments, build, test, and keep
going until the success criteria are met — escalating to a human only where judgment
genuinely matters. Every claim the organisation holds carries a status and a provenance,
and debate is what changes that status.

**The owner's standing bar:** *at minimum it is the best-looking, most performant,
simple and easy-to-use communication app, with AI agents built in where useful.
Everybody should feel at home and shouldn't lack any feature the other apps have.*
Communication parity comes first; the organisation underneath is what makes it more
than another chat app, not an excuse for it to be a worse one.

## Commands

```bash
bun run setup       # install, generate, migrate, seed — one command, fresh clone
bun run dev         # app (:3000) + orchestrator, together
bun run check       # typecheck + lint + docs link check + tests — fast, no browser
bun run smoke       # 141 browser checks; needs `bun run dev` in another terminal
bun run shots       # regenerate the 29 screenshots in docs/images/
```

Running one test, or one case:

```bash
bun test src/lib/search                      # a directory
bun test src/lib/events/__tests__/spine.concurrency.test.ts
bun test -t "rings the other person"         # by name, across the suite
```

Both browser suites need a Chromium and are deliberately **not** part of
`bun run check`. If Playwright's default is missing:
`PLAYWRIGHT_CHROMIUM=/path/to/chrome bun run smoke`.

Other useful ones: `bun run db:migrate` (create a migration — use
`--create-only` when hand-writing SQL), `bun run db:deploy`, `bun run export`
(the whole org as JSON), `bun run export --backup`, `bun run mcp:example` (an
MCP server to point a connector at), `bun run seed` (clears first — that is its job).

## Orientation

Read [`docs/ONBOARDING.md`](docs/ONBOARDING.md) first — it is ten minutes and it is
written for exactly this situation. Then:

| | |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The five structural decisions everything rests on. |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Every feature, with a screenshot from the running app. |
| [`docs/STACK.md`](docs/STACK.md) | Every tool and why; what was removed; the two traps. |
| [`docs/IA-NAVIGATION.md`](docs/IA-NAVIGATION.md) | Where every surface belongs. Read before adding one. |
| [`docs/graph/`](docs/graph/README.md) | The codebase as a knowledge graph — open `index.html`. |
| [`docs/REVIEW-2026-08-23.md`](docs/REVIEW-2026-08-23.md) | The standing account of what is broken. |

## Architecture — the parts that need several files to understand

**One member identity.** There is no `User` table and no `Agent` table — one `Member`
with a `kind` discriminator and `HumanProfile` / `AgentProfile` hanging off it. This is
what makes a feature *physically unable* to work for one kind of member and not the
other. Delegation is separate: an event carries `actorMemberId` (who acted, always) and
`onBehalfOfMemberId` (whose authority, rarely). An assistant and its owner share a
*reach* and can read each other's private events. (ADR-0009)

**The event spine.** `src/lib/events/spine.ts` is the **only** writer. `seq` is the
primary key so SQLite allocates it — that is what removes the read-`MAX`-then-insert
race. Every payload crosses a zod boundary in `schema.ts` first. Edits and deletes are
*new events* (`MessageEdited` supersedes; `MessageRedacted` stops the body being served)
so the log stays gapless and replayable. (ADR-0004, ADR-0008)

**Two access questions, not one.** `canRead()` in `src/lib/conversations.ts` decides
whether you can reach a room. `visibleTo()` in `src/lib/events/visibility.ts` decides
what is inside it. `visibleTo()` returns a Prisma `where` fragment and **every read path
takes it** — the window, the sidebar preview, thread replies, search. It is a fragment
rather than a filter over the result because the window asks for `limit + 1` rows to
learn whether history precedes it.

**The adapter seam.** A member that is an agent names a harness and a model; the
registry maps the name to an adapter (`anthropic`, `ollama`). Everything a model returns
crosses `parseAgentOutput` before it can reach the spine. With no model configured a turn
**fails naming the environment variable** rather than falling back to something that
sounds like an answer. (ADR-0006)

**The orchestrator** polls a *leased* queue, so a crashed worker's item returns on its
own. **Five of fifteen stages are built** (`filed`, `routing`, `problem_definition`,
`shipped`, `killed`); the other ten are declared `implemented: false` in
`src/lib/orchestrator/stages.ts` and the product refuses to move an objective into one.
This is the largest piece of unfinished work in the repo. (ADR-0007)

**The `shape.ts` pattern.** When a client component needs a constant or a pure function
from a module that imports Prisma, the pure half goes in `shape.ts` and the client
imports *that*. Importing anything from the server module ships the query engine to the
browser. This has bitten twice — `src/lib/calls/shape.ts`, `src/lib/search/shape.ts`.

**Two traps that cost an hour each.** (1) Tailwind v4 puts utilities in
`@layer utilities`, and an **unlayered** rule beats every layered one whatever its
specificity — a bare `*` selector in `globals.css` silently kills every border-colour
utility in the app. Reset rules go in `@layer base`. (2) `schema.prisma` cannot express
the FTS5 virtual table, so it lives in raw SQL in a migration; `migrate deploy` is fine,
but if `migrate dev` offers to drop it, use `--create-only`.

## How I work on this

Every task runs the same five-step loop, and every loop is reviewed from three seats
before it closes.

1. **Research** — read the local code and the real docs before writing anything. Find a
   proven approach rather than inventing one. Say what was found.
2. **Action** — small vertical slices (schema → route → UI → test) that each leave the
   app runnable. Never a slice that only compiles.
3. **Result** — run it. Screenshot it. Query the database. Paste the output. No claim of
   "done" without evidence in the transcript.
4. **Information** — name what failed as precisely as what worked, including when the
   failure is mine. Parse the actual error, don't guess at it.
5. **Adjustment** — research the fix, update the plan, loop back to step 2 until
   resolved.

**Three seats, every slice:** *architect* (does this scale, does it fit the ADRs),
*critic* (what breaks, what did I not test, what would a hostile reviewer find), *user*
(would I enjoy using this, is it obvious).

## Design principles

Applied to code, architecture and decisions — not only to visuals.

| | |
|---|---|
| **Simple** | The smallest thing that fully solves it. One concept, one place. If a feature needs a new top-level destination, it probably belongs inside one that exists. |
| **Powerful** | Solve the real problem, not the demo of it. No scripted theatre standing in for a working mechanism. |
| **Performant** | 60 fps at 5,000 messages. Deterministic work before model work. Measure, don't assume. |
| **Scalable** | Correct under concurrency from the first commit. One writer, real indexes, no O(n) fan-out that only looks fine when seeded. |
| **Efficient** | Cheapest tier that does the job — deterministic rules before a cheap model before an expensive one. Every run records its cost. |
| **Beautiful** | Dense information, calm presentation. Colour carries meaning, never decoration. Both themes designed, not inverted. |
| **Functional** | It works on real workloads, not fixtures. Keyboard-operable. Every surface has a URL. |

## Working guidelines (Karpathy)

Behavioural rules that reduce the mistakes LLMs actually make. They bias toward
caution over speed; for trivial tasks, use judgment. Source:
`github.com/multica-ai/andrej-karpathy-skills`.

### 1. Think before coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first
**The minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: *would a senior engineer call this overcomplicated?* If yes, simplify.

### 3. Surgical changes
**Touch only what you must. Clean up only your own mess.**
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor what isn't broken.
- Match existing style, even where you'd do it differently.
- Notice unrelated dead code? Mention it. Don't delete it.
- Remove imports and variables that *your* change orphaned — nothing older.

The test: every changed line traces directly to the request.

*Where this meets the rebuild:* P3 replaces `src/app/` and `src/components/`
because the owner asked for it, so those changes do trace to the request. Inside
any one slice the rule still holds — no drive-by improvements, no opportunistic
refactors riding along in the diff.

*The standing example:* `src/components/ui/` is 48 files of shadcn scaffold from
the original template, of which only `toaster.tsx` is reachable. It holds 40+
unused dependencies. It is **mentioned, not deleted** — see
[`docs/STACK.md`](docs/STACK.md#the-dead-scaffold).

### 4. Goal-driven execution
**Define success criteria. Loop until verified.**
Turn tasks into verifiable goals:
- "Add validation" → "write tests for invalid inputs, then make them pass"
- "Fix the bug" → "write a test that reproduces it, then make it pass"
- "Refactor X" → "ensure tests pass before and after"

For multi-step work, state the plan with its checks up front:
```
1. [step] → verify: [check]
2. [step] → verify: [check]
```
Strong criteria allow looping independently. Weak criteria ("make it work") force
constant clarification.

**These are working if:** diffs contain fewer unnecessary changes, fewer rewrites
follow from overcomplication, and clarifying questions arrive before
implementation rather than after the mistake.

## Definition of done

A slice is not done until all of these hold:

- `bunx tsc --noEmit` is clean. `ignoreBuildErrors` stays **off**.
- Lint clean. Tests written and passing, including the failure path.
- Runs from a **fresh clone** with one command, on a machine that has never seen it.
- Verified in a real browser against real data — screenshot in the transcript.
- Correct under concurrency where concurrency is possible (a test that proves it).
- No developer-facing copy, debug toggles, or TODO stubs on a user-visible surface.
- Both themes checked. Mobile checked. No horizontal page overflow.
- Errors say what went wrong and how to fix it.

## Rules that hold everywhere

- **Parity is a schema property.** Any column that can hold an agent must be able to
  hold a human, and the reverse. If a feature needs an `agentId`, the design is wrong.
  (ADR-0009)
- **The event spine is append-only and has exactly one writer.** Never `update` or
  `delete` an `Event` from application code. (ADR-0004, ADR-0008)
- **Claims transition; they are never re-created.** Status moves only via
  `ClaimStatusChanged`. (ADR-0005)
- **Every read path takes `visibleTo()`.** Never write the visibility rule a second
  time — not in raw SQL, not as a filter over a result.
- **Nothing is committed to `main`.** Work lands on the feature branch only.
- **No secrets in the repo.** `.env` is ignored; `.env.example` is committed.

## Architecture decisions

Read before changing the shape of anything. `docs/adr/`:

| | |
|---|---|
| 0001 | Tech stack |
| 0002 | Simulated agents (v1 — being replaced) |
| 0003 | Data model |
| 0004 | Event spine — append-only typed events |
| 0005 | Epistemic ledger — claim status + provenance |
| 0006 | Agent adapter interface and registry |
| 0007 | Orchestrator — a durable work runtime |
| 0008 | One writer owns the event spine |
| 0009 | One member identity, and delegated action |

## Keeping the documentation true

`bun run docs:check` (part of `bun run check`) resolves every relative link and image
in every markdown file, including heading anchors. `bun run shots` regenerates every
screenshot in `docs/FEATURES.md` by driving the real app — which is what makes that
document checkable rather than aspirational. If you change a feature, re-run it.

Note that `bun run smoke` posts into the seeded channels and leaves the messages behind
(the spine is append-only). `tests/shots.ts` works around this by opening conversations
at `?before=<seq>` just past the test residue, computed at runtime.
