# ADR-0008: One writer owns the event spine

Status: proposed · 2026-08-23 · amends ADR-0004

## Context

`Event.seq` is declared `Int @unique` and is intended to be a monotonic ordering key for
replay. Two independent processes currently allocate it against the same SQLite file:

- **The Rust substrate** (`mini-services/vuno-substrate/src/main.rs:100`) takes a mutex,
  runs `SELECT seq FROM Event ORDER BY seq DESC LIMIT 1`, then inserts rows with
  `id = format!("evt-{}", next_seq)`. `api/debate` uses this path.
- **The TypeScript `EventSpine`** (`src/lib/events/spine.ts:24`) opens the same file
  through Prisma, runs `findFirst({ orderBy: { seq: 'desc' } })`, then inserts inside a
  transaction. Eleven API routes and the seeder use this path.

Neither knows about the other. SQLite's default isolation does not prevent two
transactions from reading the same maximum and both attempting `max + 1`. Because the
Rust path derives `Event.id` from `seq`, a collision breaks on the primary key as well
as on the unique index.

This is dormant today only because nothing in Vuno is concurrent. ADR-0007 removes that
property deliberately: parallel agent runs are the point.

## Decision

**One process owns all appends. Reads stay direct and parallel.**

1. `Event.seq` becomes `INTEGER PRIMARY KEY AUTOINCREMENT` in SQLite. Application code
   stops computing it. The database is the only allocator, and it is monotonic by
   construction.
2. `Event.id` gets its own `cuid()`, independent of `seq`.
3. SQLite runs in WAL mode (`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000`) so
   readers never block the writer.
4. All appends route through the orchestrator process. `EventSpine.append()` becomes a
   client of it rather than a second writer. `EventSpine.replay()` and every read path
   keep talking to the database directly.
5. A regression test fires 50 concurrent appends and asserts 50 distinct, gapless,
   strictly increasing `seq` values.

Also in scope, same file: `src/lib/db.ts` constructs `new PrismaClient({ log: ['query'] })`
with no environment guard, so every read and write is serialised to stdout. Under a
polling orchestrator that is continuous write amplification on the hot path, and in
production it puts message bodies into the log. It becomes
`log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']`.

## Alternatives rejected

**Retry on unique-constraint violation.** Hides a correctness bug behind a loop, and
under real contention degrades badly — every writer retries against the same contended
maximum.

**A distributed sequence service.** Solves a problem we do not have. There is one
database file.

**Give up on gapless `seq` and order by timestamp.** Timestamps collide at millisecond
resolution and are not monotonic across a clock adjustment. Replay determinism is the
property ADR-0004 exists to provide; it is not negotiable.

## Consequences

- Replay stays deterministic under concurrency, which is what makes the ledger
  auditable at all.
- The Rust substrate either becomes the single writer or is retired. Deciding that is
  cheap once the write path is behind one interface — it is not decided here.
- A migration is required. Existing `evt-{seq}` ids are preserved; only new rows use
  cuids.
