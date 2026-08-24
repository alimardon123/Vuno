# Vuno — architecture

A communication app on the surface. A working organisation underneath.

This document is the mental model. It explains the five structural decisions the
whole codebase rests on, why each was made, and what breaks if you undo it. If
you read one file before touching this repo, read this one.

Companion documents:

| | |
|---|---|
| [`FEATURES.md`](FEATURES.md) | every feature, with a picture and where its code lives |
| [`STACK.md`](STACK.md) | every tool in the build, and why it is there |
| [`ONBOARDING.md`](ONBOARDING.md) | an agent's first hour on this project |
| [`IA-NAVIGATION.md`](IA-NAVIGATION.md) | where every surface belongs, and why |
| [`adr/`](adr/) | the decisions themselves, dated, with the alternatives |

---

## The idea

Humans and AI agents are **both first-class members of the same organisation**,
on the same teams, in the same rooms, with the same workflow. You set an
objective; teams discuss it, challenge each other with evidence, run
experiments, build, test, and keep going until the success criteria are met —
escalating to a person only where judgment genuinely matters.

Two properties follow from that and shape everything:

1. **Every claim the organisation holds carries a status and a provenance.**
   Debate is what changes that status. This is the *epistemic ledger*.
2. **Everything that happened is on one append-only log.** Not a side effect of
   the UI — the log *is* the org's memory, and every surface is a read of it.

---

## The five loads

### 1. One member identity (ADR-0009)

There is **no `User` table and no `Agent` table**. There is one `Member` table
with a `kind` discriminator, and profile rows hanging off it:

```
Member ──┬── HumanProfile   (email, password hash)
         └── AgentProfile   (harness, model, owner)
```

**The rule: parity is a schema property.** Any column that can hold an agent
must be able to hold a human, and the reverse. If a feature needs an `agentId`,
the design is wrong.

This is not a style preference. It is what makes a feature *physically unable*
to work for one kind of member and not the other — the roster, the mention
autocomplete, channel membership, the review metrics and the call participant
list are all one code path because they are all one table.

**Delegation** is separate from identity. An event carries `actorMemberId` (who
did it, always) and `onBehalfOfMemberId` (whose authority it carried, rarely).
An assistant acting for its owner still renders as itself; the delegation is
recorded, not disguised. An assistant and its owner share a *reach* — each can
read the other's private events — which is what lets an owner audit what their
assistant concluded before it spoke.

> `src/lib/members/`, `src/lib/events/visibility.ts`

### 2. The event spine, append-only, one writer (ADR-0004, ADR-0008)

```prisma
model Event {
  seq           Int      @id @default(autoincrement())   // the database allocates it
  id            String   @unique @default(cuid())
  type          String                                    // discriminated union key
  payload       String                                    // JSON, typed in TS, validated by zod
  actorType     String                                    // 'member' | 'system'
  actorMemberId String?
  onBehalfOfMemberId String?
  scopeType     String   // 'channel' | 'decision' | 'project' | 'team' | 'org' | 'tenant'
  scopeId       String
  visibility    String   @default("org")                  // 'tenant' | 'org' | 'team' | 'private'
  targetEventId String?                                   // for events that act on another
}
```

**Never `update` or `delete` an `Event` from application code.** There are no
exceptions in the product, and the rules that look like exceptions are not:

- **Edit** appends `MessageEdited`. The original stays exactly as posted, and a
  later event supersedes it. The org can still answer "what did it say when I
  agreed to it".
- **Delete** appends `MessageRedacted`. The row stays, the body stops being
  served. The sequence stays gapless and a reply still has something to point at.

`seq` is the primary key so **SQLite allocates it** — `AUTOINCREMENT` is only
available on an `INTEGER PRIMARY KEY`, and having the database own the sequence
is what removes the read-`MAX`-then-insert race. Measured: 100 concurrent
appends produce **100 gapless sequence numbers**, no exceptions.

`targetEventId` is a *projection* of the payload, not a second source of truth.
It exists because rendering a window has to ask "what happened to these forty
messages" on every paint, and SQLite cannot index into a JSON string.

> `src/lib/events/spine.ts` — the only writer. `schema.ts` — the zod boundary.

### 3. The epistemic ledger (ADR-0005)

A `Claim` has a status: `asserted → believed → tested → falsified → uncertain`.

**Claims transition; they are never re-created.** Status moves only by appending
`ClaimStatusChanged`, so the ledger can always answer *when* the org changed its
mind and *what* changed it. A claim's current status is a fold of its events, not
a column somebody wrote.

This is the mechanism that makes "an organisation that argues" more than a
metaphor: an objection with evidence is an event that moves a claim's status,
and a gate can refuse to let work proceed while a claim is falsified.

> `src/lib/ledger/claims.ts`, `src/lib/gates/`

### 4. Visibility is a `where` fragment, in one place

Conversation membership decides whether you can reach a room. `Event.visibility`
decides what is inside it. They are different questions and were once answered
by the same check — which is how an agent that declared a thought private posted
it to the channel for everyone.

```
org, tenant   everyone who can reach the conversation
team          members of the team the conversation belongs to
private       the member who wrote it, and whoever shares their identity
```

The rule is one function, `visibleTo(reach, teamScopeIds)`, returning a Prisma
`where` fragment — **used by every read path**: the conversation window, the
sidebar preview, thread replies, and search.

It is a `where` fragment rather than a filter over the result for a reason worth
keeping: the window asks for `limit + 1` rows to learn whether history precedes
it. Dropping rows afterwards would shrink the page and lie about what came
before. SQLite applies `LIMIT` after the filter, so asking the database keeps the
window exact.

**If you add a read path, it takes this fragment.** Writing the rule a second
time in raw SQL is how the leak comes back.

> `src/lib/events/visibility.ts`

### 5. The adapter seam (ADR-0006)

A member that is an agent names a **harness** and a **model**. The registry maps
the harness name to an adapter; two are built:

| adapter | what it is |
|---|---|
| `anthropic` | the Claude API. Current models, real prices, cost recorded per run. |
| `ollama` | a local model. Same interface, no key, no bill. |

Everything a model returns crosses **one validation boundary**, `parseAgentOutput`,
before it can reach the spine. A model that returns malformed JSON, an unknown
event type, or a claim status that does not exist fails there — it never gets to
write.

With no model configured, a turn **fails on the first attempt saying which
environment variable to set**. It never falls back to something that sounds like
an answer. That is deliberate: a plausible fabricated answer in an epistemic
ledger is worse than an error.

> `src/lib/agents/` — `registry.ts`, `adapters/`, `turn.ts`, `budget.ts`

---

## How a request flows

```
Browser
  │
  ├─ GET  /channels/[id]        Server Component
  │        └─ listMessages() ── visibleTo() ─── SQLite
  │
  ├─ POST /api/messages         route → zod → EventSpine.append() → SQLite
  │                                            (the one writer)
  ├─ GET  /api/stream           SSE, "anything after seq N?" every 1.5s
  │
  └─ GET  /api/search           FTS5 ranks → visibleTo() filters → SQLite

Orchestrator  (separate process, same database)
  │
  └─ leased queue ── stage handler ── adapter ── parseAgentOutput ── append
```

Two processes, one SQLite file in WAL mode. The orchestrator polls a **leased**
queue rather than a locked one, so a crashed worker's item returns on its own
when the lease expires.

---

## The orchestrator, and what is honestly built

An objective moves through a stage ladder. Each stage declares what work it
enqueues on entry.

```
filed → routing → problem_definition → divergent_proposal → debate →
experiment → decision → handoff → implementation → verification →
release → operating → retrospective → shipped        (killed is an exit, not a step)
```

**Five of the fifteen stages are built**: `filed`, `routing`,
`problem_definition`, `shipped`, `killed`. The other ten are designed in
ADR-0007 and declared in `stages.ts` with `implemented: false`, and the product
says so rather than pretending — moving an objective into an unbuilt stage is
refused with the reason, and the board only draws columns for stages that are
built or occupied.

**This is the largest single piece of unfinished work in the repository.** If you
are picking this project up and looking for the next substantial thing, it is
here.

> `src/lib/orchestrator/stages.ts` — the ladder and the `implemented` flags.

---

## Search

Fifty thousand messages with no way to find one is a filing cabinet with the
drawers welded shut. The index is a **SQLite FTS5 virtual table whose rowid is
`Event.seq`**, kept true by SQL triggers rather than application code — four
processes write to this database, and an index maintained in one of them drifts
in the other three.

Two phases, deliberately:

1. **FTS5 ranks.** It answers "which messages contain these words, best first"
   and knows nothing about who is asking.
2. **Prisma filters**, using `visibleTo()` — the same fragment as every other
   read path.

The cost of the split is a cap (the top 500 matches are ranked, then filtered).
The benefit is that the security rule has exactly one implementation.

A redaction **deletes the row from the index**. Everywhere else "deleted" means
the body stops being served; here a search result *is* the body.

Measured on the seeded spine (50,247 indexed messages, p50 of 15 runs):

```
a distinctive word                        0.2 ms
two words, one of them in every message   0.3 ms
the whole call, room names included      10.0 ms
one ultra-common word, alone             53.0 ms
```

> `src/lib/search/`, `prisma/migrations/20260824160000_search/`

---

## Performance, measured

Not estimated. Run against 50,561 events on the spine:

```
sequential append                              1,005 events/s
100 concurrent appends                         1,461 events/s
gaps in sequence numbers                               0
opening a channel (50 posts + their replies)      14.8 ms
opening a chat (200 messages)                      6.3 ms
one live-conversation poll                        0.46 ms
```

**The ceiling is the live connection**, not the writes. Every open conversation
holds an SSE stream asking "anything after sequence N" every 1.5 s. At 0.46 ms a
query, one process saturates at roughly **3,200 conversations open at once** —
call it a few hundred people actually working, on one box.

Past that, three things change together and none is small: SQLite becomes
Postgres, the poll becomes a subscription, and the rate-limit counters (which
live in one process's memory) need somewhere shared. The single-writer rule was
designed to survive that move — it becomes an advisory lock rather than a
redesign.

---

## Rules that hold everywhere

- **Parity is a schema property.** Any column that can hold an agent must hold a
  human, and the reverse. (ADR-0009)
- **The event spine is append-only and has exactly one writer.** Never `update`
  or `delete` an `Event` from application code. (ADR-0004, ADR-0008)
- **Claims transition; they are never re-created.** Status moves only via
  `ClaimStatusChanged`. (ADR-0005)
- **Every read path takes `visibleTo()`.** Never write the visibility rule twice.
- **Nothing is committed to `main`.** Work lands on the feature branch only.
- **No secrets in the repo.** `.env` is ignored; `.env.example` is committed.

---

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
