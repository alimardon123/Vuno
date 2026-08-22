# AI Organization OS — Key Screens (Wireframe Descriptions)

> Companion to `DESIGN_SYSTEM.md`. Describes the 5 critical screens for v1. Implementation will match these.

## 1. App Shell (everywhere)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [logo] AI Org OS  · Acme Corp ▾  · TechCo ▾ (disabled, v2)   [theme] [?] │  ← top bar
├────────────┬─────────────────────────────────────────────────┬───────────┤
│            │                                                 │           │
│  CHANNELS  │                                                 │  CONTEXT  │
│  ────────  │              (page content)                      │  ──────── │
│  # storage │                                                 │  (varies  │
│  # api     │                                                 │   by page)│
│  ...       │                                                 │           │
│            │                                                 │           │
│  AGENTS    │                                                 │           │
│  ────────  │                                                 │           │
│  ◎ Arch    │                                                 │           │
│  ◎ Eng     │                                                 │           │
│  ...       │                                                 │           │
│            │                                                 │           │
└────────────┴─────────────────────────────────────────────────┴───────────┘
│ [footer: tenant · org · version · docs]                                    │
└───────────────────────────────────────────────────────────────────────────┘
```

Left rail: channels list (with unread badge), then agents list (with health dot). Right rail: contextual — on a decision page, shows related claims and participants; on a channel, shows channel members and pinned decisions; on ledger, shows filters summary.

## 2. Channel View (chat surface)

```
┌─────────────────────────────────────────────────────┐
│ # storage-engine  · 4 members · pinned: Decision#17│  ← header
├─────────────────────────────────────────────────────┤
│                                                     │
│  [◎ Maya] Product Lead · 10:24                     │
│  Filed Objective #17: sub-50ms p99 reads            │
│                                                     │
│  [⬛ Aris] Architect · 10:31                        │
│  ▌PROPOSAL  ─ believed                              │
│  "Mmap-based LSM with bloom filters..."             │
│  → Open decision page                               │
│                                                     │
│  [⬛ Peri] Performance · 11:02                       │
│  ▌BENCHMARK REPORT  ─ falsifies                     │
│  "p99 = 142ms at 10k concurrent readers..."          │
│  → Open evidence                                    │
│                                                     │
├─────────────────────────────────────────────────────┤
│ [type a message... ▾]  [Post]                       │  ← typed composer
└─────────────────────────────────────────────────────┘
```

The typed composer has a dropdown: `Message` (default) / `Proposal` / `Objection` / `Evidence` / `Benchmark Report` / `Decision`. Selecting a non-default type opens a structured form.

Typed messages get a left-border in the semantic color and a small uppercase type label.

## 3. Decision Page (GitHub-PR-style)

```
┌──────────────────────────────────────────────────────────────────┐
│ Decision #17  ·  Architecture: storage engine           [blocked]│
│ Opened by Aris · 2 hours ago · 4 participants · 3 evidence       │
├────────────────────────────────────────┬─────────────────────────┤
│ PROPOSAL                              │ STATUS CHECKS            │
│ ─────────                             │ ─────────────            │
│ "Mmap-based LSM with bloom filters    │ ✓ Security    (no risk)  │
│  for point lookups..."                │ ✓ QA          (passed)  │
│                                       │ ✗ Performance (blocked) │
│ REJECTED ALTERNATIVES                 │                          │
│ ────────────────────────              │ [Release gate: blocked] │
│ 1. B-Tree only  — rejected: write     │                          │
│    amplification at scale              │ PARTICIPANTS             │
│ 2. Hash index   — rejected: no range  │ ────────────             │
│    queries                           │ ◎ Aris    (proposer)      │
│                                       │ ◎ Sid     (reviewer)      │
│ OPEN RISKS                            │ ◎ Devi    (devil's advocate)│
│ ─────────                             │ ◎ Peri    (verifier)      │
│ (none)                                │                          │
├───────────────────────────────────────┴─────────────────────────┤
│ DISCUSSION (anchored to proposal sections)                       │
│ ─────────                                                        │
│ > On "bloom filters for point lookups"                            │
│ [◎ Devi] Devil's Advocate · 10:55                                │
│ "Bloom filters add 1.5x memory overhead; is the tradeoff worth   │
│  it at 10k concurrent?" → request experiment                      │
│                                                                   │
│ > On "Mmap-based LSM"                                             │
│ [◎ Peri] Performance · 11:00                                      │
│ "Will benchmark. Need 30min." → experiment running                │
│                                                                   │
│ [◎ Peri] Performance · 11:02                                     │
│ ▌BENCHMARK REPORT  p99 = 142ms                                   │
│ "Result falsifies the believed claim that p99 < 50ms."            │
│ → Claim #42 status: believed → falsified                           │
└───────────────────────────────────────────────────────────────────┘
```

The blocked status badge pulses once when the gate fails. The "Claim #42 status: believed → falsified" line links to the ledger entry.

## 4. Ledger View (the distinctive surface)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Epistemic Ledger                              [filter: project ▾]   │
│                                                  [filter: status ▾]│
│                                                  [filter: actor ▾] │
├─────────────────────────────────────────────────────────────────────┤
│ CLAIM                          STATUS    PROVENANCE        EVID  CON│
│ ─────────                     ────────  ────────────────   ────  ──│
│ p99 reads < 50ms at 10k...    ✗falsified Peri · bench     1     0 │
│ Mmap-LSM meets criteria       ⚠uncertain Aris · proposal 0     1 │
│ Bloom filters add 1.5x mem   ✓tested    Devi · experiment1     0 │
│ B-Tree has write amp at scale ✓tested    Sid · benchmark  2     0 │
│ ...                                                                  │
├─────────────────────────────────────────────────────────────────────┤
│ Showing 4 of 23 claims                                              │
└─────────────────────────────────────────────────────────────────────┘
```

Status icons: ✓ tested (emerald), ⚠ uncertain (gray), ✗ falsified (red-orange), ◇ believed (sky), ○ asserted (amber). Each row links to a detail view with the full provenance chain.

## 5. Agent Registry

```
┌─────────────────────────────────────────────────────────────────────┐
│ Agents                                                  [+ Install] │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────┐│
│ │ ◎ Aris              │ │ ◎ Sid               │ │ ◎ Devi           ││
│ │ Distributed Sys    │ │ Security Architect  │ │ Devil's Advocate ││
│ │ Architect          │ │                     │ │ (QA)             ││
│ │ simulated/echo-1   │ │ simulated/echo-1    │ │ simulated/echo-1 ││
│ │ Engineering · ●ok   │ │ Security · ●ok       │ │ QA · ●ok         ││
│ └─────────────────────┘ └─────────────────────┘ └─────────────────┘│
│ ...                                                                 │
├─────────────────────────────────────────────────────────────────────┤
│ Click any agent to view: manifest, installed events, recent activity│
└─────────────────────────────────────────────────────────────────────┘
```

The "+ Install" button opens a dialog with the form described in ADR-0006.

## 6. New Objective Form (modal)

```
┌──────────────────────────────────────────────────────┐
│ File New Objective                            [✕]   │
├──────────────────────────────────────────────────────┤
│ Title                                                │
│ [Build storage engine with sub-50ms p99 reads______]│
│                                                      │
│ Success Criteria                                     │
│ [p99 < 50ms at 10k concurrent readers______________]│
│                                                      │
│ Constraints                                          │
│ [single-node first; open-source dependencies only__]│
│                                                      │
│ Budget        Autonomy      Routing                  │
│ [$400]        [Level 2 ▾]   [Product ▾]              │
│                                                      │
│                          [Cancel]  [File Objective] │
└──────────────────────────────────────────────────────┘
```

Filing emits an `ObjectiveFiled` event to the spine. The objective appears in the routed team's channel as a typed message.
