# Vuno — Product Requirements Document (v1, updated)

> Companion to `upload/ai-org-os-product-vision-v2.md` and `upload/ai-org-os-workflow-and-features.md`.
> This PRD was scoped at the start and is updated to reflect the current build state.

## 1. One-sentence promise

> Don't give me one AI assistant. Give me an organization of specialized intelligences that debate, build, test, and improve until the objective is met — and show me exactly why every decision was made.

## 2. The problem

Working with a single coding agent has a specific failure shape: it stays in one context, looks at the same files, reasons from the same priors, and cannot step outside its own frame. Asking it again produces a variation, not an alternative. This is a **diversity problem**, not a capability problem. One model sampled three times gives three points from the same distribution — identical blind spots.

## 3. The product

A communication app on the surface (Slack/Teams-like: channels, threads, @-mentions). Underneath, a working organization of specialized AI agents and humans who genuinely collaborate: they propose, challenge each other with evidence, run experiments, block each other at quality gates, and build real things — while everyone watches it happen. The differentiator is **traceable, falsifiable reasoning**: every claim has a status (`asserted → believed → tested → falsified → uncertain`) and provenance, and debate is the state-transition function that moves claims between statuses.

## 4. Current build state (updated)

### ✅ Done
- **Tenant + Organization** data model (tenant now; multiple orgs per tenant later; v1 ships with one pre-seeded org)
- **Departments + Teams + Members** minimal vertical slice (Product, Engineering, Security, Performance, QA, HR/Meta)
- **Event spine** — append-only typed events; chat is a projection of the log
- **Epistemic ledger** — claims with status + provenance; filterable ledger view
- **Agent registry** — install/configure agents (independent + personal-assistant kinds); simulated adapters with adapter interface designed for real-agent swap-in
- **Channels** — Slack-like, agents + humans as first-class members
- **Decision pages** — GitHub-PR-style: artifact, anchored discussion, required status checks (gates), reviewers with formal states
- **Typed composer** — Proposal / Objection / Evidence / Benchmark / Decision — filing a Proposal triggers the agent debate chain
- **Debate engine** — state machine: `draft → open → contested → experiment-pending → resolved | escalated`
- **Gate engine** — declarative policy evaluated as a query over the ledger
- **Killer demo end-to-end**: an architecture proposal reaches `believed`, a performance agent runs a (simulated) benchmark, the result `falsifies` it, the decision record shows exactly why, and the gate blocks the build
- **Pre-seeded sample org** — a "storage-engine company" with the falsification arc already populated
- **Sleek visual design** — warm cream/mustard palette (Buzz from Block inspired), dark-capable, Inter type, dense but calm
- **Three-panel left rail** — Chats / Channels / Org / HR / Settings (Teams-style icon rail)
- **Agent-as-colleague treatment** — image-style avatars (initials), `agent` and `personal` badges
- **Real-time chat via socket.io** (port 3003) — WebSocket push, typing indicators, room-based subscriptions
- **Concurrent agent debate** — Security + DevilsAdvocate wake in parallel (Promise.all), events stream one-by-one, variable delays for "live conversation" feel
- **Rust substrate service** (port 3030) — owns the event spine writer (tokio + axum + rusqlite)
- **AgentThought / memory graph** — agents reason aloud (observation → hypothesis → conclusion → doubt); thoughts are visible to other agents via `/api/thoughts`; the shared cognitive space
- **Project Wiki** — generated entirely from the ledger, not maintained beside it
- **HR / Meta dashboard** — metrics visualized as charts (recharts): objection precision, proposal survival rate, gate evaluations, event-type histogram, agent activity table
- **Timeline scrubber** on decision pages — time-travel the debate (replay events from seq=N)

### 🚧 In progress
- **Wire Next.js API routes to proxy to Rust** — the Rust substrate is running but Next.js still uses Prisma directly for spine operations
- **Thought-to-thought edges** — the `relatedThoughtId` field exists but isn't used yet by adapters

### ❌ Explicitly deferred
- Voice and multimodal meetings (deferred per vision §8)
- Cross-organization collaboration (no users until orgs exist)
- Agent package registry (format now, marketplace later)
- Promotion mechanic (needs a mature ledger + real assistant history)
- Real LLM agent execution (simulated in v1; adapter ready for real in v2 via MCP)
- Multi-user real-time presence / WebSocket typing (socket.io is built; full presence is later)
- Real cloud / GitHub / CI integration (simulated benchmarks in v1; real execution plane in v2)
- Level-4 full autonomy (not achievable at current model capability)
- Full department/role/permission system depth (minimal in v1, grows in slices)

## 5. Architecture

```
[Next.js UI (port 3000)]
    ↕ socket.io (port 3003 via Caddy XTransformPort=3003)
    ↕ HTTP proxy
[Rust substrate (port 3030)] — owns the event spine (tokio + axum + rusqlite)
    ↕
[SQLite] — shared DB
    ↕
[Agent adapters (simulated)] — produce events + AgentThoughts
```

- **Next.js**: UI + API routes + socket.io broadcast client
- **Rust substrate**: event spine writer (append + replay) — the core of the product
- **socket.io service**: real-time transport (room-based fan-out, typing indicators)
- **Agent adapters**: simulated in v1, designed for real LLMs via MCP in v2

## 6. Design principles

| Principle | How Vuno delivers |
|---|---|
| **Simple** | One event type for everything (including thoughts); one transport (socket.io); one spine (Rust) |
| **Powerful** | Concurrent agents, real-time streaming, memory graph, falsifiable reasoning |
| **Performant** | Rust substrate (no GC, no JIT), WebSocket push (no polling) |
| **Scalable** | Room-based subscriptions, queryable thought graph, adapter interface for real LLMs |
| **Efficient** | No wasted polling, single transport, compiled Rust binary |
| **Beautiful** | Buzz-inspired warm palette, italic thoughts, status-color pills, icon rail |
| **Functional** | Filing a proposal triggers a live concurrent debate with streaming + typing indicators |

## 7. Build sequence (executed so far)

1. ✅ Walking skeleton: schema + chat + decision + ledger + agent registry
2. ✅ Pre-seed sample org + falsified proposal + benchmark + blocked gate
3. ✅ Killer demo: typed composer + debate chain + gate-as-ledger-query + falsification arc
4. ✅ UI overhaul: Buzz-inspired warm palette, icon rail, agent-as-colleague badges
5. ✅ Real-time chat via socket.io (port 3003)
6. ✅ Concurrent agent debate (Promise.all + streaming + typing indicators)
7. ✅ Rust substrate service (port 3030) — event spine writer in Rust
8. ✅ Memory graph: AgentThought events + /api/thoughts + shared cognitive space
9. 🚧 Wire Next.js to proxy to Rust
10. 🚧 Thought-to-thought edges + argument graph visualization
11. ❌ Real-LLM agent adapter via MCP (rmcp crate in Rust)
12. ❌ ACP for agent-to-agent comms
