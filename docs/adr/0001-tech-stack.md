# ADR-0001: Technology Stack (updated)

**Status:** Accepted
**Date:** 2025-01-01 (updated 2025-08-22)
**Decider:** orchestrator (Z.ai Code main)

## Context

Vuno is a local-first (v1) application that pretends to be Slack/Teams on the surface but is a working AI organization underneath. The substrate (event spine, epistemic ledger, work graph) must support append-only writes, replay, audit, and time-travel. The chat surface is a projection of the event log, not the source of truth. We need a stack that handles (a) server-side persistence with strong typing, (b) a real-time chat UI with WebSocket push, (c) integration points for both simulated and real agent adapters, (d) a Rust substrate for the event spine (per the user's explicit request), and (e) a sleek component system inspired by Buzz from Block.

## Decision

We adopt a **hybrid architecture** — Next.js for the UI + API layer, Rust for the substrate, socket.io for real-time transport.

**Core (UI + API):**
- **Next.js 16 (App Router)** — server components for ledger reads, API routes for event-spine writes (proxied to Rust), RSC for the chat projection
- **TypeScript 5** — strict typing throughout; the event spine's typed events and the ledger's claim statuses are TS discriminated unions
- **Tailwind CSS 4** — warm Buzz-inspired cream/mustard palette on top of CSS variables (oklch color space)

**Substrate (Rust — port 3030):**
- **Rust** (tokio + axum + rusqlite) — owns the event spine writer. Every event append goes through Rust. Per the user's explicit request: "I still want Rust backend for things." Buzz from Block validates this ("a suspicious number of Rust crates").
- Why Rust over Go/C: tokio gives true concurrent async, ownership model makes the append-only invariant enforceable at compile time, zero-cost abstractions, no GC pauses.

**Real-time transport (socket.io — port 3003):**
- **socket.io** mini-service — WebSocket push, room-based subscriptions (per-channel fan-out), typing indicators. Server-to-server via socket.io client (auth.role='server').

**Persistence:**
- **Prisma 6 + SQLite** — local-first v1. The Rust substrate writes to the same SQLite DB via rusqlite. Prisma reads from it for projections.
- A single `db` client via `src/lib/db.ts` (Prisma) + direct rusqlite connection in the Rust service.

**UI:**
- **shadcn/ui (New York)** — full component set. Composition patterns for: typed-message cards, claim-status pills, gate-status checks, decision-page layout, ledger table, agent-registry cards, AgentThought rendering (italic + thought-type pill).
- **lucide-react** — icons
- **framer-motion** — CSS keyframe animations (msg-fade-in, panel-slide-in, status-pulse). Full framer-motion component integration is a later slice.
- **next-themes** — light-capable (warm cream is primary, warm dark available)

**Server state:**
- **TanStack Query** for ledger reads and event-spine projections
- **Zustand** for ephemeral client UI state (composer type, active channel, ledger filters, left-panel switcher, typing indicators)

**AI + Memory (backend only):**
- **z-ai-web-dev-sdk** — available for future real-agent adapter (v2 via MCP). NOT used in v1.
- **AgentThought events** — agents reason aloud (observation → hypothesis → conclusion → doubt), producing thoughts visible to other agents via `/api/thoughts`. This is the "shared cognitive space" — the memory graph.

**Form/validation:**
- **react-hook-form + zod** — for the typed composer and objective-filing forms

## Consequences

- **Pro:** Hybrid TS + Rust gives the best of both worlds: fast UI iteration (TS) + performant substrate (Rust).
- **Pro:** socket.io gives real-time push with room-based fan-out — scalable to many channels.
- **Pro:** AgentThought events create the shared cognitive space — agents see each other's reasoning.
- **Con:** Two languages (TS + Rust) — but the boundary is clean: Rust owns the spine, TS owns everything else.
- **Con:** The Rust substrate and Next.js share the same SQLite DB — potential for connection contention. Mitigated by SQLite's WAL mode.
- **Risk:** z-ai-web-dev-sdk must stay backend-only. We will never import it from a client component.
