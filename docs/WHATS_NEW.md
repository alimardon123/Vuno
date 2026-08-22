# What's Genuinely New Here

*Short memo, scoped to what differentiates Vuno from existing products. Companion to `PRD.md`.*

## Existing categories and why this isn't them

**Slack/Teams/Mattermost** — communication surface only. No substrate. No ledger. No debate. No gates. Vuno shares the *form* (channels, threads, @-mentions) but the chat is a *projection of an event spine*, not the source of truth. The differentiator is underneath the surface.

**AutoGen / CrewAI / LangGraph** — multi-agent *pipelines*. They suffer the well-documented failure: an early error propagates unchallenged through every downstream stage. Vuno is an *organization* — debate is the state-transition function; downstream can reopen upstream; experiments outrank arguments; deadlock escalates rather than loops. The four rules in vision §4 are the structural defense, and they don't exist in those frameworks.

**GitHub PRs** — the inspiration for decision pages (anchored discussion, status checks, reviewers with formal states). But PRs are an artifact-level surface; Vuno decision pages are first-class objects in a work graph, with ledger-backed claims, evidence, and gate queries.

**Self-consistency / Constitutional AI / Debate papers (academic)** — these are sampling or alignment techniques. Vuno is a *product* that operationalizes the principle: every claim has status + provenance, debate is the mechanism that changes status, and gates query the ledger deterministically.

## What is genuinely new

1. **The epistemic ledger as the source of truth.** Every claim has `status ∈ {asserted, believed, tested, falsified, uncertain}` plus provenance. The chat surface is a projection. The wiki is generated from the ledger, not maintained beside it. This is the thing that doesn't exist elsewhere.

2. **Debate as a state machine with formal roles and evidence weighting.** Auto-assigned roles (reviewer, devil's advocate, domain expert, verifier). Objections without evidence expire after one round. Experiments break ties. This is operationalized falsification, not prompting.

3. **The 3-tier attention router for continuous review.** Deterministic rules fire free; a cheap classifier triages; the expensive specialist wakes only if those fire. This is what makes ambient background review cost cents per hour instead of hundreds of dollars per day. Without this, the entire continuous-review thesis fails economically.

4. **Gates as deterministic queries over the ledger.** "Security gate passes when no open RiskFlag of severity ≥ high exists on this project's artifacts." Not a prompt. Testable, explainable, replayable.

5. **Model plurality as a structural mechanism, not a checkbox.** Different model families for divergent proposals (genuinely different priors). Adversarial review uses a *different* model from the proposer (no shared blind spots). Cost-tiered routing. Roles separate from models separate from harnesses separate from tools.

6. **Promotion: assistant → independent agent via distillation.** Grow an org agent by accumulating one person's decision-making patterns, then extract role-relevant patterns and drop personal facts. The owner reviews the diff. This is the only credible path to a genuinely good org agent, and it doubles as institutional knowledge capture.

7. **HR as a peer-to-CEO meta team.** HR agents are ordinary agents whose work objects are agents and teams. They read everything, write only proposals about the org, go through the same debate and gates. They measure objection precision, proposal survival rate, gate-block accuracy. This is impossible before the ledger and nearly trivial after.

8. **The killer demo as falsification.** The proof is not "AI built my app" — it is *"an architecture proposal reached believed, a benchmark falsified it, the decision record shows exactly why, and the gate blocked the build."* If that loop works end-to-end, there's something here.
