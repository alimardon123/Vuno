# ADR-0001: Technology Stack

**Status:** Accepted
**Date:** 2025-01-01
**Decider:** orchestrator (Z.ai Code main)

## Context

AI Organization OS is a local-first (v1) application that pretends to be Slack/Teams on the surface but is a working AI organization underneath. The substrate (event spine, epistemic ledger, work graph) must support append-only writes, replay, audit, and time-travel. The chat surface is a projection of the event log, not the source of truth. We need a stack that handles (a) server-side persistence with strong typing, (b) a real-time-feeling chat UI without mandatory WebSocket in v1, (c) integration points for both simulated and real agent adapters, and (d) a sleek component system that can render dense information (ledger views, decision pages, status pills, provenance chains) without becoming visual noise.

## Decision

We adopt the existing project stack without modification, plus a few additions for the AI-org OS substrate.

**Core:**
- **Next.js 16 (App Router)** — server components for ledger reads (cheap, cacheable), API routes for event-spine writes, RSC for the chat projection
- **TypeScript 5** — strict typing throughout; the event spine's typed events and the ledger's claim statuses are TS discriminated unions
- **Tailwind CSS 4** — sleek design system on top of CSS variables (oklch color space)

**Persistence:**
- **Prisma 6 + SQLite** — local-first v1; the event spine is append-only (no `UPDATE` on events), the ledger is mutable claims referencing immutable events. SQLite is appropriate for solo-local-first and supports the time-travel/replay thesis well at this scale.
- A single `db` client via `src/lib/db.ts`.

**UI:**
- **shadcn/ui (New York)** — full component set already present. We add composition patterns for: typed-message cards, claim-status pills, gate-status checks, decision-page layout, ledger table, agent-registry cards.
- **lucide-react** — icons
- **framer-motion** — subtle transitions (debate state transitions, claim status changes, gate evaluations)
- **next-themes** — dark-capable; dark is the primary, light available

**Server state:**
- **TanStack Query** for ledger reads and event-spine projections
- **Zustand** for ephemeral client UI state (composer type, active channel, ledger filters)

**AI (backend only):**
- **z-ai-web-dev-sdk** — available for future real-agent adapter (v2). NOT used in v1 — agents are simulated through the same adapter interface.

**Form/validation:**
- **react-hook-form + zod** — for the typed composer and objective-filing forms

## Consequences

- **Pro:** Single language (TS) across the whole stack. SQLite makes local-first real. shadcn gives us dense layouts for free. The event spine's append-only rule is enforced at the Prisma layer (no `update` calls on Event rows).
- **Con:** SQLite won't scale to a real cloud multiplayer deployment — but that's v2's problem, and Prisma's datasource is a one-line swap when we get there.
- **Con:** Without WebSocket in v1, the chat won't have live presence — but async polling on a 5s interval is fine for the killer demo, and socket.io is a known later addition.
- **Risk:** z-ai-web-dev-sdk must stay backend-only. We will never import it from a client component.
