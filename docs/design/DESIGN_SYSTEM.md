# Vuno — Design System

> Warm, sleek, refined — inspired by Buzz from Block (block.xyz). The chat surface is dense but calm; the ledger view is the distinctive surface that should feel "unlike anything else."

## 1. Aesthetic principle

**Dense information, calm presentation.** Inspired by Buzz from Block: warm cream backgrounds, mustard/gold accents, charcoal text — NOT cold blue/emerald. The product should feel like a "living room" for engineering teams, not a "dashboard."

- **Restraint over decoration.** One accent color (mustard/gold). No gradients on chrome. No skeuomorphic shadows. Subtle elevation only.
- **Type does the heavy lifting.** Hierarchy via size, weight, and color — not via containers.
- **Status is first-class.** The product's epistemic states (`asserted / believed / tested / falsified / uncertain`) and gate states (`passed / blocked / pending`) are visually distinct, not just labeled.
- **Provenance is visible.** Every claim, every decision, every gate references its source. The UI shows the chain, not just the result.

## 2. Color palette

**Base scale (light mode primary — Buzz-inspired warm cream):**
- `--background`: oklch(0.98 0.006 85) — warm off-white/cream
- `--foreground`: oklch(0.18 0.006 60) — warm dark charcoal
- `--card`: oklch(1 0.003 85) — pure white
- `--card-foreground`: oklch(0.18 0.006 60)
- `--popover`: oklch(1 0.003 85)
- `--muted`: oklch(0.94 0.012 85) — warm muted
- `--muted-foreground`: oklch(0.48 0.01 60) — warm grey secondary text
- `--border`: oklch(0.88 0.008 60 / 50%) — subtle warm border
- `--input`: oklch(0.92 0.012 85)

**Accent — mustard/gold (Buzz-inspired, replaces emerald):**
- `--primary`: oklch(0.52 0.13 70) — muted gold/mustard (darkened for WCAG AA)
- `--primary-foreground`: oklch(0.99 0.003 85) — light text on gold
- `--ring`: oklch(0.52 0.13 70 / 40%) — focus ring

**Dark mode (warm dark — NOT cold blue-black):**
- `--background`: oklch(0.15 0.008 60) — warm charcoal
- `--foreground`: oklch(0.94 0.008 80) — warm off-white
- `--primary`: oklch(0.70 0.14 75) — brighter gold for dark

**Semantic — claim status (the load-bearing color system):**
- `--status-asserted`: oklch(0.55 0.13 60) — amber (unverified, neutral caution)
- `--status-believed`: oklch(0.50 0.13 230) — sky (provisionally accepted — cool contrast with warm bg)
- `--status-tested`: oklch(0.50 0.12 145) — warm green (verified by experiment)
- `--status-falsified`: oklch(0.50 0.20 25) — warm red-orange (refuted by evidence)
- `--status-uncertain`: oklch(0.45 0.01 60) — warm grey (needs investigation)

**Semantic — gate / debate state:**
- `--gate-passed`: warm green (matches `--status-tested`)
- `--gate-blocked`: warm red-orange (matches `--status-falsified`)
- `--gate-pending`: amber (matches `--status-asserted`)

**Light mode:** Same palette, inverted L values. Background goes to oklch(0.99 0 0), foreground to oklch(0.15 0.005 250), etc. The accent emerald stays the same.

## 3. Typography

- **Sans:** Inter (already wired via `--font-geist-sans`; we'll add Inter via next/font if Geist feels too neutral — TBD in implementation)
- **Mono:** JetBrains Mono for event types, claim IDs, code snippets, provenance IDs (via `--font-mono`)

**Hierarchy:**
- Display: text-2xl (1.5rem), font-semibold, tracking-tight — only for page titles
- H1: text-xl (1.25rem), font-semibold, tracking-tight
- H2: text-lg (1.125rem), font-medium
- Body: text-sm (0.875rem), text-foreground
- Secondary: text-sm, text-muted-foreground
- Mono/Code: text-xs (0.75rem), font-mono, text-muted-foreground

**Tight leading on dense surfaces:** `leading-snug` (1.375) for chat messages and ledger rows.

## 4. Spacing & density

- Page padding: `p-6` on desktop, `p-4` on mobile
- Card padding: `p-4` for dense cards (ledger rows, event timeline items), `p-6` for hero/decision pages
- Stack gap: `gap-4` default, `gap-2` for tight lists (chat messages), `gap-6` for major sections
- Border radius: `--radius: 0.5rem` — slightly tighter than the shadcn default for a more technical feel

## 5. Component treatment

**Cards:** `bg-card` with `border` (`border-border`), no shadow. On hover: `border-ring/40` for interactive cards.

**Status pills:** Small, monochrome background with the status color at 12% opacity, text in the status color. Example: `bg-[--status-believed]/12 text-[--status-believed]`. No border.

**Buttons:**
- Primary: `bg-primary text-primary-foreground` — emerald, used sparingly (only for the main CTA on each page)
- Secondary: `bg-secondary text-secondary-foreground`
- Ghost: `hover:bg-accent` — used for most navigation

**Decision page (the distinctive surface):** Modeled on a GitHub PR. Left column = the artifact (proposal text, rejected alternatives, evidence). Right column = status checks (gates) at the top, then anchored discussion below. Status checks use the gate-state colors.

**Ledger view (the other distinctive surface):** A dense table. Each row: claim statement (left, ~50% width), status pill, provenance (actor + event type + time), evidence count, contradicts count. Filterable by project, status, actor.

**Chat surface:** Slack-like. Left rail = channels + DMs + agents. Center = thread. Right rail (collapsible) = context (current decision, related claims, related agents). Message rows show actor avatar, name, role badge, timestamp, message body. Typed messages (proposals, objections, evidence) get a left-border accent in their semantic color and a small type label.

**Agent cards:** Avatar (lucide icon by role — e.g. `ShieldCheck` for security, `Cpu` for engineering, `Users` for HR), name, role, model/harness mono text, status badge, health dot.

## 6. Animation principles

- Subtle. Framer Motion for: page transitions (150ms ease), debate state transitions (300ms, with a brief status-pill pulse), gate evaluations (the blocked-gate alert slides in), ledger filter changes (200ms).
- No bouncing, no spring on chrome. Spring is OK for content reflow.

## 7. Accessibility

- Min 44px touch targets on mobile
- Status colors paired with text labels (never color-only)
- Keyboard nav: every interactive element focusable; focus ring visible (`--ring`)
- `sr-only` for icon-only buttons
- Reduced-motion respected (`@media (prefers-reduced-motion: reduce)`)

## 8. Responsive

- Mobile-first. Three-column layout collapses: left rail → drawer, center → full width, right rail → sheet (slide up from bottom)
- Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280
- Decision page: side-by-side at `lg+`, stacked below

## 9. Footer (per house rules)

Sticky to bottom. `min-h-screen flex flex-col` on root wrapper; footer gets `mt-auto`. Contains: project name, current tenant/org, version, link to docs.
