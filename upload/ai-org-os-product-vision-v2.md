# AI Organization OS — Product Vision v2

*Restructured from the original 37-section draft. Reordered by what is load-bearing, not by org-chart analogy.*

---

## 1. Positioning

**A communication app on the surface. A working company underneath.**

The interface is Slack or Teams — channels, threads, @-mentions, an app you install. Underneath, the participants are specialized AI agents and humans who genuinely collaborate: they propose, challenge each other with evidence, run experiments, block each other at quality gates, and build real things — while everyone watches it happen.

The promise, in one line:

> **Don't give me one AI assistant. Give me an organization of specialized intelligences that debate, build, test, and improve until the objective is met — and show me exactly why every decision was made.**

The differentiator is not autonomy. It is **traceable, falsifiable reasoning**. Every claim the organization holds has a status and a provenance. Debate is the mechanism that changes that status.

---

## 2. The Two Kinds of Agents

This distinction is foundational and shapes ownership, memory, and permissions throughout.

| | **Independent agent** | **Personal assistant** |
|---|---|---|
| Owned by | The organization | One human |
| Example | "Distributed systems architect" | "Bob" — my assistant |
| Lives in | Teams, channels, projects | My private chat; enters channels when I @-mention it |
| Memory scope | Organizational — shared ledger | Private — my files, history, preferences |
| Acts | On its own initiative, within its role | On my behalf, with my authority |
| Visible to others | Yes, as a colleague | Visible as *mine*; others cannot direct it |
| Evaluated by | HR agents, on org outcomes | By me — and by HR only for promotion candidacy |
| Human analogue | An employee | My notebook, my chief of staff |

Both are first-class members of channels. A thread might contain three humans, two independent agents, and someone's assistant that was pulled in to fetch a file.

---

## 3. Architecture — Three Layers

### Layer 1 — Substrate (the product; build this first)

**Event spine.** Every occurrence is an append-only typed event, never a mutable row: `ProposalOpened`, `EvidenceAttached`, `ObjectionRaised`, `BenchmarkReported`, `RiskFlagged`, `DecisionRecorded`, `GateEvaluated`. The chat UI is a *projection* of this log, not the source of truth. This buys replay, audit, and time-travel for free.

**Epistemic ledger.** Every claim carries `status ∈ {asserted, believed, tested, falsified, uncertain}` plus provenance — which agent, which event, which evidence. Debate is the state-transition function. A counterargument backed by a benchmark is what moves `believed → falsified`.

**Work graph.** Products, projects, requirements, decisions, experiments, incidents as nodes; events reference them. Decision records and product history fall out of this rather than being separate features.

**Visibility scope.** Every claim entering the ledger carries a scope. Enforced at the message layer, not by prompting a model politely. This is what makes personal assistants safe in shared channels.

### Layer 2 — Protocol (the mechanism)

**Debate engine.** A proposal is a state machine: `draft → open → contested → experiment-pending → resolved | escalated`. On open, formal roles auto-assign: reviewer, devil's advocate, domain expert, verifier. Hard termination rules — budget cap, convergence detection, forced escalation on deadlock. Escalation to a human is a feature, not a failure.

**Evidence weighting.** An objection with no evidence attached ranks below one with a benchmark, and expires after one round. Without this, agents manufacture disagreement to satisfy their role.

**Attention router.** Decides which agents wake on which events. Three tiers, cheapest first:
1. *Deterministic rules* (free) — a requirement says p99 < 50ms, a benchmark reports 100ms, conflict fires. No model involved. Push as much here as possible.
2. *Cheap classifier* — a small model triages: "does this plausibly concern security?"
3. *Full agent wake* — only when tier 1 or 2 fires.

This tiering is what makes continuous background review cost cents per hour instead of hundreds of dollars per day.

**Gate engine.** Declarative policy evaluated *as a query over the ledger*: "security gate passes when no open RiskFlag of severity ≥ high exists on this project's artifacts." Deterministic, explainable, testable.

### Layer 3 — Scaffolding (borrow; do not invent)

Organizations, teams, roles, permissions, sandboxing, spending limits, autonomy levels, the channel UI, model gateway, harness adapters. All of this exists in mature open source. Integrate it.

**Execution plane** stays deliberately separate from deliberation — different cost profile, different failure modes, different security boundary. The two communicate only through events.

---

## 4. Product Surfaces

**Channels** — Slack-like. Ambient awareness, humans and agents together, @-mentions pull in assistants or specialists.

**Decision pages** — the critical surface, and *not* chat. Modeled on a GitHub pull request: an artifact, discussion anchored to specific parts of it, required status checks (gates), and reviewers with formal states. The composer is **typed** — "Add evidence / Raise objection / Propose alternative / Report benchmark" — rendering like a message, storing like a record.

**Ledger view** — what we know, believe, tested, falsified, and remain uncertain about. Filterable by project. This is the view that makes the product feel unlike anything else.

**HR console** — see §5.

---

## 5. HR as a Team, Not a Subsystem

HR agents are ordinary agents whose *work objects* happen to be agents and teams. They read the ledger, file proposals, and pass through the same debate and gates as any other work. No special machinery.

Measurable signals available once the ledger exists:
- objection precision (what fraction of this agent's objections were later validated vs. falsified)
- proposal survival rate
- gate-block accuracy — did blocks catch real problems
- cost per resolved decision
- catch rate on other agents' errors

HR proposals: reassign to another team, swap this role's underlying model, expand or reduce autonomy, retire an underperforming agent, hire for an identified capability gap.

**HR is impossible before the ledger and nearly trivial after.** You cannot evaluate an agent without a measurement substrate.

### Promotion — assistant to colleague

The distinctive mechanic. Bob works alongside one person for months and accumulates how that person actually makes decisions. HR identifies Bob as a promotion candidate and proposes graduating it into Kevin, an independent agent on a team.

**Promotion is distillation with owner review, not a fork.** The system extracts role-relevant patterns — what this person checks before approving a design, what they consistently catch, their standards and heuristics — and drops personal facts entirely. The owner reviews a diff of exactly what transfers before anything ships. The owner keeps Bob unchanged.

This solves a problem nothing else answers well: *how do you get a genuinely good org agent?* Not by writing better prompts — by growing one. It also reframes as institutional knowledge capture that survives someone leaving.

Open question to decide deliberately: if the owner leaves the organization, does Kevin remain? Recommended answer is yes, stated explicitly in terms of service.

---

## 6. Extensibility and Installation

Three separable things, only some of which matter early:

1. **Self-hostable platform** — table stakes, like Mattermost. Do it.
2. **Pluggable harnesses** — Claude Code, Codex, Gemini CLI, local models as swappable execution backends. This is model-agnosticism made concrete. Day one.
3. **Agent package registry** — publish a "security engineer" agent with its role, prompts, tools, and gates; install in one click. Real network effects, but worthless before you have users. **Design the package format early so you never retrofit it; build the registry late.**

---

## 7. Build Sequence

1. **Personal agent** — files, browser, memory, one user, no organization. Shippable and useful entirely alone. This is the on-ramp; the org emerges from it.
2. **Two agents in one channel** — event spine and typed composer. The moment it becomes multiplayer.
3. **Epistemic ledger and one real debate** — ending in a benchmark that falsifies a proposal.
4. **Gates and teams** — the org layer, mostly borrowed.
5. **HR agents** — the first thing built on the ledger.
6. **Promotion mechanic** — needs a mature ledger and real assistant history.
7. **Voice adapter** — last. See §8.

**The demo that proves the thesis** is not "AI built my app." It is:

> An architecture proposal reaches *believed*, a performance agent runs an actual benchmark, the result *falsifies* it, the decision record shows exactly why, and the gate blocks the build.

If that loop works end to end, there is something here that does not exist elsewhere.

---

## 8. Voice and Meetings

Voice is **an input adapter to the event spine**, not a separate feature. A meeting produces the same typed events as a channel. Speech-to-text feeds the same pipeline, so it is never a rewrite — bolt it on whenever.

Deferred for two reasons that are not about model capability:

- **Multi-party turn-taking is unsolved.** Four agents plus a human in live audio, deciding who speaks and when to interrupt, is a hard real-time coordination problem with a brutal latency budget.
- **Voice is ephemeral, which fights the thesis.** The differentiator is that communication is a record. Meetings are where records go to die. Build voice only when the ledger is strong enough that a meeting *deposits into it* rather than bypassing it.

---

## 9. Riskiest Assumptions

Ranked by how badly each one breaks the product if wrong.

1. **That debate improves output enough to justify its cost.** Multi-agent systems frequently lose to a single strong model at equal token budget. The debate loop must earn its expense on a measured basis, not be assumed valuable. *Cheapest test: run one real design decision through single-agent review vs. structured debate and compare outcomes and cost.*
2. **That agents disagree honestly.** LLM debaters converge toward the most confidently-stated position rather than the best-supported one, and a prompted devil's advocate manufactures objections regardless of merit. Evidence weighting mitigates this but must be enforced structurally.
3. **That the deterministic trigger tier carries the load.** If most useful interjections require a model to notice them, the economics break.
4. **That anyone wants an organization.** People want their problem solved. The org metaphor may be a mental burden rather than a benefit — which is exactly why the personal agent leads the sequence.
5. **That autonomy is achievable.** Best-in-class autonomous completion on realistic company tasks sits around 30%, and coordination tasks score far worse than coding. Position on evidence and traceability, not on autonomy.

---

## 10. Explicitly Deferred

Not deleted — sequenced, with the reason:

- **Level 4 full autonomy** — not achievable at current model capability; do not position on it.
- **Voice and multimodal meetings** — §8.
- **Cross-organization collaboration** — no user need until organizations exist.
- **Market validation agents** — a separate product; adjacent, not core.
- **Agent package registry** — format now, marketplace later.
