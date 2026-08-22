# AI Organization OS — Product Requirements Document (v1)

> Companion to `upload/ai-org-os-product-vision-v2.md` and `upload/ai-org-os-workflow-and-features.md`. This PRD scopes the **v1 build** for this engagement.

## 1. One-sentence promise

> Don't give me one AI assistant. Give me an organization of specialized intelligences that debate, build, test, and improve until the objective is met — and show me exactly why every decision was made.

## 2. The problem

Working with a single coding agent has a specific failure shape: it stays in one context, looks at the same files, reasons from the same priors, and cannot step outside its own frame. Asking it again produces a variation, not an alternative. This is a **diversity problem**, not a capability problem. One model sampled three times gives three points from the same distribution — identical blind spots.

## 3. The product

A communication app on the surface (Slack/Teams-like: channels, threads, @-mentions). Underneath, a working organization of specialized AI agents and humans who genuinely collaborate: they propose, challenge each other with evidence, run experiments, block each other at quality gates, and build real things — while everyone watches it happen. The differentiator is **traceable, falsifiable reasoning**: every claim has a status (`asserted → believed → tested → falsified → uncertain`) and provenance, and debate is the state-transition function that moves claims between statuses.

## 4. v1 scope (this engagement)

### In scope
- **Tenant + Organization** data model (tenant now; multiple orgs per tenant later; v1 ships with one pre-seeded org)
- **Departments + Teams + Members** minimal vertical slice (Product, Engineering, Security, HR as a starting set; one team per department, 1-3 agents per team)
- **Event spine** — append-only typed events; chat is a projection of the log, not the source of truth
- **Epistemic ledger** — claims with status + provenance; filterable ledger view
- **Agent registry** — install/configure agents (independent + personal-assistant kinds); simulated agents in v1, adapter interface designed so real agents drop in later
- **Channels** — Slack-like, agents + humans as first-class members
- **Decision pages** — GitHub-PR-style: artifact, anchored discussion, required status checks (gates), reviewers with formal states
- **Typed composer** — Add evidence / Raise objection / Propose alternative / Report benchmark / File proposal / Record decision — renders like a message, stores like a record
- **Debate engine** — state machine: `draft → open → contested → experiment-pending → resolved | escalated`
- **Gate engine** — declarative policy evaluated as a query over the ledger
- **Killer demo end-to-end**: an architecture proposal reaches `believed`, a performance agent runs a (simulated) benchmark, the result `falsifies` it, the decision record shows exactly why, the gate blocks the build
- **Pre-seeded sample org** — a "storage-engine company" with the falsification arc already populated so a first-time visitor sees the thesis in 10 seconds
- **Sleek visual design** — dark-capable, refined typography, single restrained accent color

### Explicitly out of scope for v1 (sequenced, not deleted)
- Voice and multimodal meetings (deferred per vision §8)
- Cross-organization collaboration (no users until orgs exist)
- Agent package registry (format now, marketplace later)
- Promotion mechanic (needs a mature ledger)
- Real LLM agent execution (simulated in v1; adapter ready for real in v2)
- Multi-user real-time presence / WebSocket (async in v1; socket.io in a later slice)
- Real cloud / GitHub / CI integration (simulated benchmarks in v1; real execution plane in v2)
- Level-4 full autonomy (not achievable at current model capability)
- Full department/role/permission system depth (minimal in v1, grows in slices)

## 5. User stories (the golden path)

1. **Open the app.** I see my organization. Channels on the left. A sample pre-seeded debate already in flight.
2. **Open the decision page.** An architecture proposal is in `believed` state. Reviewers are assigned. Status checks (gates) show: security ✓, performance ✗.
3. **Read the ledger.** The performance agent's benchmark report is recorded as a `tested` claim. Its result `falsifies` the architecture's "p99 < 50ms" belief.
4. **See the gate block.** The release gate evaluates: "no open RiskFlag of severity ≥ high exists on this project's artifacts" — fails. Build is blocked.
5. **Read the decision record.** What was chosen, why, which alternatives were rejected, who participated, what evidence supports it. Full anatomy.
6. **Install an agent.** Go to the agent registry, install a new "Security Architect" agent (simulated v1), assign to the Security team.
7. **File a new objective.** Typed form: success criteria, constraints, budget, autonomy level. Routed to Product.

## 6. Measurable success criteria for v1

- The killer demo (falsification arc) renders end-to-end and is reproducible from the seeded data
- The event spine stores every action as a typed event and the chat is a true projection (rebuild chat from events)
- The ledger view filters by project, by claim status, by provenance agent
- Gate evaluation is a deterministic query over the ledger, not a prompt
- The agent registry supports install + configure (role, model-name, harness-name — simulated in v1)
- The whole app runs locally with `bun run dev`, no external API keys required for the demo

## 7. Non-goals (re-stated, for clarity)

- Not a real autonomous company (autonomy is not the differentiator; traceability is)
- Not a single-agent product (the org is the product)
- Not a Slack replacement (chat is the surface, not the differentiator)
- Not production multi-user cloud (local-first v1; cloud is a later evolution)

## 8. Risk register (carried over from vision §9)

1. Debate improves output enough to justify cost — *mitigated in v1 by being simulated; the demo proves the form*
2. Agents disagree honestly — *mitigated structurally via evidence weighting
3. Deterministic trigger tier carries the load — *demonstrated structurally in v1*
4. Anyone wants an organization — *tested by the killer demo; the personal-agent slice comes in v2*
5. Autonomy is achievable — *explicitly not promised; positioned on evidence and traceability*

## 9. Build sequence for this engagement

1. Walking skeleton: schema + chat surface + decision page surface + ledger view surface + agent registry surface (read-only / minimal)
2. Pre-seed sample org + falsified proposal + benchmark + blocked gate
3. Killer demo: typed composer + full debate state machine + gate-as-ledger-query + falsification arc rendered
4. Polish, QA with Agent Browser, ship v1
