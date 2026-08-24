# Picking up Vuno

You are an agent (or a person) taking over this project. This is the shortest
path to being useful. Read it top to bottom once; it takes about ten minutes.

---

## 1. What this is, in four sentences

Vuno is a communication app on the surface and a working organisation
underneath. **Humans and AI agents are both first-class members of the same org**
— same teams, same rooms, same workflow, same database table. You set an
objective; teams discuss it, challenge each other with evidence, run experiments,
build and test, escalating to a person only where judgment genuinely matters.
Every claim the org holds carries a status and a provenance, and debate is what
changes that status.

The owner's standing bar: *at minimum it is the best-looking, most performant,
simple and easy-to-use communication app, with AI agents built in where useful.
Everybody should feel at home and shouldn't lack any feature the other apps have.*

That framing matters when you are deciding what to build. **Communication parity
comes first**; the organisation underneath is what makes it more than another
chat app, not an excuse for it to be a worse one.

---

## 2. Get it running

```bash
bun run setup     # install, generate, migrate, seed — works on a fresh clone
bun run dev       # app on :3000 + orchestrator, together
```

Sign in as `kai@acme.storage`. On a fresh seed the first sign-in claims the owner
account and you set the password.

```bash
bun run check     # typecheck + lint + test — run this constantly
bun run smoke     # 141 browser checks; needs `bun run dev` in another terminal
```

If Chromium is missing: `PLAYWRIGHT_CHROMIUM=/path/to/chrome bun run smoke`.

---

## 3. Read these, in this order

| | | why |
|---|---|---|
| 1 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | The five structural decisions everything rests on. Non-negotiable. |
| 2 | [`../CLAUDE.md`](../CLAUDE.md) | How work is done here — the loop, the seats, the rules. |
| 3 | [`FEATURES.md`](FEATURES.md) | What exists, with pictures. Skim; return to it. |
| 4 | [`IA-NAVIGATION.md`](IA-NAVIGATION.md) | Where every surface belongs, and why there are seven tabs and not nine. Read before adding any surface. |
| 5 | [`STACK.md`](STACK.md) | The tools, and the two traps (Tailwind layering, Prisma + virtual tables). |
| 6 | [`adr/`](adr/) | 0004 (spine), 0005 (ledger), 0008 (one writer), 0009 (identity) before changing the shape of anything. |
| 7 | [`REVIEW-2026-08-23.md`](REVIEW-2026-08-23.md) | The standing account of what is broken and why. |

---

## 4. The rules you cannot break

These are load-bearing. Breaking one does not fail a test — it corrupts the
product's guarantees quietly.

1. **Parity is a schema property.** Any column that can hold an agent must hold a
   human, and the reverse. **If a feature needs an `agentId`, the design is
   wrong.** (ADR-0009)
2. **The event spine is append-only with exactly one writer.** Never `update` or
   `delete` an `Event` from application code. Edits and deletes are *new events*.
   (ADR-0004, ADR-0008)
3. **Claims transition; they are never re-created.** Status moves only via
   `ClaimStatusChanged`. (ADR-0005)
4. **Every read path takes `visibleTo()`.** Never write the visibility rule a
   second time — not in raw SQL, not as a filter over a result. That is exactly
   how the sidebar-preview leak happened.
5. **Nothing is committed to `main`.** Work lands on the feature branch only —
   currently `claude/teams-communication-app-9ttkqp`.
6. **No secrets in the repo.** `.env` is ignored; `.env.example` is committed.

---

## 5. How work is done here

Every task runs the same five-step loop:

1. **Research** — read the local code and the real docs before writing anything.
   Find a proven approach rather than inventing one. Say what was found.
2. **Action** — small vertical slices (schema → route → UI → test) that each
   leave the app runnable. Never a slice that only compiles.
3. **Result** — run it. Screenshot it. Query the database. Paste the output.
   **No claim of "done" without evidence in the transcript.**
4. **Information** — name what failed as precisely as what worked, including when
   the failure is yours. Parse the actual error, don't guess at it.
5. **Adjustment** — research the fix, update the plan, loop back to step 2.

**Three seats, every slice:** *architect* (does this scale, does it fit the
ADRs), *critic* (what breaks, what did I not test, what would a hostile reviewer
find), *user* (would I enjoy using this, is it obvious).

And the working guidelines that actually reduce mistakes: state assumptions
rather than hiding them; write the smallest thing that fully solves it; touch
only what you must; turn every task into a verifiable goal before starting.

---

## 6. Where things are

```
src/
  app/
    (app)/            the seven rail destinations + /search + /settings
    (auth)/sign-in/
    api/              route handlers; every write goes through the spine
  lib/
    events/           ← spine.ts is the ONLY writer. schema.ts is the zod boundary.
                        visibility.ts is the ONE visibility rule.
    conversations.ts  ← how a channel and a chat are read differently
    messages/         react, reply, edit, delete, pin — all as events
    members/          one roster: roster.ts, org-tree.ts, mentionable.ts
    ledger/           claims and their transitions
    work/             the board; gates/ evaluates
    orchestrator/     the leased queue, the stage ladder, the handlers
    agents/           registry + adapters (anthropic, ollama) + budget
    search/           index.ts (server) / shape.ts (client-safe half)
    calls/            index.ts (server) / shape.ts (client-safe half)
    apps/             the Extensions catalogue
    skills/ plugins/ connections/    Settings
  components/
    vuno/             the actual UI
    ui/               ⚠ 47 dead shadcn files; only toaster.tsx is reachable
prisma/
  schema.prisma       32 models
  migrations/         14, committed. Raw SQL where Prisma cannot express it.
tests/
  smoke/smoke.ts      141 browser checks
  shots.ts            the screenshots in docs/images/
docs/                 you are here
catalogue/            three shippable plugin manifests
```

**The `shape.ts` pattern.** When a client component needs a constant or a pure
function from a module that imports Prisma, the pure half goes in `shape.ts` and
the client imports *that*. Importing anything from the server module ships the
whole query engine to the browser. This has bitten twice (calls, then search).

---

## 7. What to work on next

In the order it would matter:

1. **The orchestrator stage ladder.** Ten of fifteen stages are designed in
   ADR-0007 and declared with `implemented: false`. This is the largest
   unfinished piece and the one that most changes what the product *is* —
   without it, "the org argues its way to an answer" is five stages long.
2. **The rest of the agent package manifest** (ADR-0006): the gates a plugin may
   block, permissions, evaluation. Designed, not built.
3. **Delete the dead scaffold.** 47 files, 40+ dependencies, ~5,400 lines. The
   cleanest available win — see [STACK.md](STACK.md#the-dead-scaffold).
4. **Notifications that reach a closed tab.** Push, email, or a desktop app.
   Right now if the tab is closed nothing reaches you, and that is the largest
   gap against Teams/Slack parity.
5. **Past one box**: SQLite → Postgres, the SSE poll → a subscription, and the
   in-memory rate-limit counters → somewhere shared. These change together.

---

## 8. Before you say "done"

- `bunx tsc --noEmit` clean, `ignoreBuildErrors` off
- lint clean, tests written and passing **including the failure path**
- runs from a fresh clone with one command
- **verified in a real browser against real data, screenshot in the transcript**
- correct under concurrency where concurrency is possible, with a test proving it
- no developer-facing copy, debug toggles, or TODO stubs on a user-visible surface
- both themes checked, mobile checked, no horizontal page overflow
- errors say what went wrong *and how to fix it*

---

## 9. Two traps that will cost you an hour

**Tailwind v4 layering.** An unlayered CSS rule beats every `@layer utilities`
rule regardless of specificity. A bare `*` selector in `globals.css` silently
kills every border-colour utility in the app. Reset rules go in `@layer base`.

**Prisma and virtual tables.** `schema.prisma` cannot express the FTS5 index, so
it lives in raw SQL in a migration. `migrate deploy` is fine. If `migrate dev`
offers to drop it, use `--create-only`.

---

## 10. Regenerating this documentation

```bash
bun run dev
bun run shots     # rewrites every image in docs/images/
```

The screenshots are produced by driving the real app — that is what makes
`FEATURES.md` checkable rather than aspirational. If a feature breaks, its
picture stops being produced.

Note that `bun run smoke` posts into the seeded channels and leaves the messages
behind (the spine is append-only; nothing deletes from it). `shots.ts` works
around this by opening conversations at `?before=<seq>` just past the test
residue, computed at runtime.
