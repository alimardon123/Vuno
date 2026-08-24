# Vuno — the stack, and why each piece is here

Every tool in the build, what it does, and the reason it was chosen over the
obvious alternative. Where something was *removed*, that is recorded too — a
stack document that only lists what is present hides the more useful half.

See [ADR-0001](adr/0001-tech-stack.md) for the original decision.

---

## Runtime and language

| | | |
|---|---|---|
| **Bun** | 1.3.11 | Runtime, test runner, package manager and script runner — one tool instead of four. `bun:test` needs no configuration and runs the whole suite in ~5 s. |
| **TypeScript** | 5.x, `strict` | `bunx tsc --noEmit` is a gate on every slice. `ignoreBuildErrors` stays **off** — a build that ships type errors is a build that ships a runtime crash. |
| **Next.js** | 16.1 (App Router) | Server Components mean the visibility rule runs on the server, next to the database, rather than being a filter a client could skip. Every surface gets a URL for free. |
| **React** | 19 | |

## Data

| | | |
|---|---|---|
| **SQLite** | via Prisma, WAL mode | One file, no server to run. `bun run setup` works on a machine that has never seen the project. WAL is what lets readers not block the writer; `busy_timeout` makes concurrent writers queue rather than error. |
| **Prisma** | 6.19 | Typed queries and a **committed migration history** — 14 migrations, applied with `migrate deploy`. It replaced `prisma db push`, which let the schema drift silently. |
| **FTS5** | SQLite built-in | Full-text search over message bodies. No search server, no second process, no new language. 0.2 ms for a distinctive word across 50k messages. Kept in sync by SQL triggers, because four processes write to this database. |

**On the migration that Prisma cannot express:** `schema.prisma` has no syntax for
a virtual table, so the FTS5 index and its triggers live in raw SQL inside
`prisma/migrations/20260824160000_search/`. `migrate deploy` — what `bun run
setup` uses — does not care. If `prisma migrate dev` ever offers to drop them,
that is the gap, and the answer is `--create-only`.

## Styling

| | | |
|---|---|---|
| **Tailwind v4** | | Seven themes, all token-driven. |
| **CSS custom properties** | | Every colour is a token on `:root` and redefined per `[data-theme]`. Components reference tokens, never literals, so a new theme is a block of variables rather than a pass over the components. |

**A trap worth knowing about.** Tailwind v4 puts its utilities in
`@layer utilities`, and **an unlayered rule beats every layered rule whatever its
specificity**. A bare `* { border-color: var(--line) }` in `globals.css` silently
overrode every border-colour utility in the app — `border-falsified`,
`border-line-2`, the agent avatar edge, all of them. The fix is to put the reset
inside `@layer base`:

```css
@layer base {
  * { box-sizing: border-box; border-color: var(--line); }
}
```

If a colour utility mysteriously does nothing, this is the first thing to check.

## Agents

| | | |
|---|---|---|
| **Anthropic API** | direct `fetch` | No SDK. The adapter is ~100 lines and the interface is the point, not the client. Current model IDs and real prices are in `src/lib/agents/registry.ts` — check them against the API docs before trusting a cost figure. |
| **Ollama** | direct `fetch` | Local models. Same adapter interface, no key, no bill. |
| **MCP** | `@modelcontextprotocol/sdk` 1.30 | Connectors. Adopted rather than invented, because it is what the harnesses we want to plug into already speak. |
| **zod** | 4.0 | Every event payload and every model response crosses a zod boundary before it can reach the spine. |

## Validation and testing

| | | |
|---|---|---|
| **bun:test** | | 343 tests across 27 files. The failure path is tested, not just the happy one. |
| **Playwright** | 1.62 | Two suites: `bun run smoke` (141 checks — real browser, real data, including a two-party WebRTC call with fake media devices) and `bun run shots` (the 29 screenshots in `docs/images/`). |
| **ESLint** | 9, `eslint-config-next` | |

Neither browser suite is wired into `bun run check` — that stays fast and
browserless. They are run deliberately.

## What is deliberately absent

**No Rust, and no second language.** There was: the code this replaced proxied
event appends to a Rust service on port 3030 and fell back to the database when
it was down. Nothing started that service — and if anything had, two processes
would have been assigning sequence numbers to the same log. Removing it is what
made the one-writer guarantee true.

The case for Rust is real where the work is CPU-bound or a process must not
pause — a media server for calls, a search index, a sync engine. The one that
came closest makes the point: full-text search over fifty thousand messages is a
job people reach for a search server to do, and it turned out to be a virtual
table inside the database that was already open. **Introducing a second language
before there is work that needs it buys a deployment story and a build story and
pays for them with nothing.**

Where reliability comes from here, it is structural rather than linguistic: the
spine is append-only with one writer, orchestrator work is *leased* rather than
locked so a crashed worker's item returns on its own, and TypeScript runs strict
with error suppression off.

**No component library.** The UI is hand-built against the theme tokens. See
below for why the one that came with the template is still on disk.

**No state manager, no data-fetching library.** Server Components read the
database directly; the handful of client components that poll use `fetch` in a
`useEffect`. Adding React Query to a codebase whose reads are server-rendered
would be a dependency in exchange for nothing.

---

## The dead scaffold

`src/components/ui/` holds **48 files, of which one is reachable** —
`toaster.tsx`, imported by `src/app/layout.tsx`. The other 47 are the shadcn/ui
scaffold that came with the original template.

They are what keeps **40+ dependencies** in `package.json` with zero imports
anywhere in `src/app`, `src/lib` or `src/components/vuno`:

```
@radix-ui/* (27 packages)   cmdk              react-hook-form
class-variance-authority     embla-carousel    react-resizable-panels
input-otp                    lucide-react      recharts
react-day-picker             sonner            vaul
tailwindcss-animate          sharp
```

(`clsx` and `tailwind-merge` *are* live — `src/lib/utils.ts` uses both for `cn()`.)

**This is left in place on purpose**, under the working rule that unrelated dead
code gets mentioned rather than deleted: removing 47 files and 40 dependencies is
its own change with its own risk, and it does not trace to any request that
produced the current work.

It is, however, the cleanest available win in the repository:

- ~5,400 lines of unread code, which is ~20% of the source tree
- 40+ dependencies out of the lockfile and the install
- a smaller attack surface and a faster cold install on a fresh clone

If you pick it up: check `toaster.tsx`'s own imports first (it reaches
`@radix-ui/react-toast`), keep `clsx` and `tailwind-merge`, and run
`bun run check` plus `bun run smoke` afterwards.

---

## Commands

```bash
bun run setup       # install, generate, migrate, seed — one command, fresh clone
bun run dev         # app + orchestrator together
bun run check       # typecheck + lint + test          (fast, browserless)
bun run smoke       # 141 browser checks against real data
bun run shots       # regenerate docs/images/
bun run export      # the whole org as JSON
bun run mcp:example # an MCP server to point a connector at
bun run db:migrate  # prisma migrate dev  (use --create-only for raw SQL)
bun run db:deploy   # prisma migrate deploy
```

## Environment

`.env` is git-ignored; `.env.example` is committed. No secrets in the repo, ever.

| | |
|---|---|
| `DATABASE_URL` | `file:../db/dev.db` — relative to `prisma/schema.prisma`, which is what the Prisma CLI wants. `scripts/start.ts` makes it absolute before starting the production server, because the bundled runtime does not know where the project is. |
| `ANTHROPIC_API_KEY` | Unset, agents fail on the first attempt naming this variable. They never fall back to something that sounds like an answer. |
| `OLLAMA_HOST` | For the local adapter. |
