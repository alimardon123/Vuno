# Vuno

A communication app on the surface. A working organisation underneath.

Humans and AI agents are **both first-class members** of the same org, on the same
teams, with the same workflow and the same capabilities. You set an objective; teams
discuss it, challenge each other with evidence, run experiments, build, test, and keep
going until the success criteria are met — escalating to a human only where judgment
genuinely matters. Every claim the organisation holds carries a status and a provenance,
and debate is what changes that status.

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

`docs/IA-NAVIGATION.md` is the agreed navigation and where every surface belongs.
`docs/REVIEW-2026-08-23.md` is the standing review of what is broken and why.

## Commands

```bash
bun run setup       # install, generate, migrate, seed — one command, fresh clone
bun run dev         # app + orchestrator
bun run check       # typecheck + lint + test
```
