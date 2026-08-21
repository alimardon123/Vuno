# AI Organization OS — Workflow and Platform Features

*Companion to the Product Vision doc. This one answers: how does work actually move through the organization, end to end?*

---

## 1. The Problem This Workflow Exists To Solve

Working with a single coding agent today has a specific failure shape: it stays in one context, looks at the same files, reasons from the same priors, and cannot step outside its own frame. Asking it again produces a variation, not an alternative.

That is a **diversity problem, not a capability problem.** One model sampled three times gives three points from the same distribution — identical blind spots. Three different model families given the same problem independently give genuinely different approaches.

So model plurality is not a checkbox feature. It is the mechanism that makes the whole workflow work, and it should be the headline claim.

---

## 2. Organization Shape

**One organization** contains departments. A realistic starting set:

Product · Research · Architecture · Engineering · Security · QA · Performance · IT/Operations · Sales and Customer Success · HR/Meta

Departments contain **teams**. Teams contain three kinds of members:

- **Independent agents** — org-owned, role-bound, work autonomously
- **Humans** — full members, not just approvers
- **Personal assistants** — summoned by their owner via @-mention, act on that owner's behalf

Every team has a **lead** (agent or human) responsible for routing work, unblocking, escalating disagreement, and deciding when work is ready to move.

### Authority model

| Role | Can do |
|---|---|
| **Org owner (you, the CEO)** | Set objectives, join any channel, override any decision, set budgets and autonomy levels, approve release gates |
| **Department head** | Set department-level targets, allocate agents, approve within-department gates |
| **Team lead** | Route work, assign debate roles, escalate, mark work ready to advance |
| **Member (agent or human)** | Propose, object, attach evidence, request experiments, block on gates within their role |
| **HR/Meta team** | Read everything; write only *proposals* about the organization itself |

The HR team is deliberately **peer to the org owner in visibility, subordinate in authority.** It sees everything and can propose anything about the organization's structure — but every HR proposal goes through the same debate and approval path as any other work. It cannot unilaterally hire, fire, or reassign.

---

## 3. The Objective Lifecycle

This is the core loop. A target enters at the top and either ships or gets killed with a recorded reason.

### Stage 0 — Objective filed

Someone with authority files an **Objective** — a typed object, not a chat message:

```
Objective #17 — "Build a storage engine with sub-50ms p99 read latency"
  success criteria: p99 < 50ms at 10k concurrent readers
  constraints: single-node first, open-source dependencies only
  budget: $400 compute, 3 weeks
  autonomy: Level 2 (approval required for architecture and release)
```

Success criteria are what gates evaluate against later. An objective without measurable criteria gets bounced back for clarification — this alone prevents most downstream drift.

### Stage 1 — Routing and intake

The objective is routed to the owning department (Product, for a product objective). Product's lead assembles a working group and pulls in Research.

### Stage 2 — Problem definition

Product and Research agents interrogate the objective: What is ambiguous? What already exists? What is the actual user need? What has been tried?

**Output:** a set of Requirements, entered into the ledger as typed claims with status. Ambiguities become explicit open questions rather than silent assumptions. Prior art research means the organization can conclude "this already exists, don't build it" — which is a legitimate and valuable outcome.

### Stage 3 — Divergent proposal (model plurality applied)

Three or four agents produce competing approaches **independently, without seeing each other's work first.** Deliberately assigned across different model families so the proposals differ structurally, not cosmetically.

This is the single highest-value moment for plurality, and it directly answers the single-agent tunnel-vision problem.

### Stage 4 — Structured debate

Proposals are published together and contested. The debate engine auto-assigns formal roles: reviewer, devil's advocate, domain expert, verifier.

Participants attach **evidence** — benchmarks, papers, prior incidents, cost models. Objections without evidence rank below objections with it, and expire after one round. Where debate cannot resolve a disagreement on reasoning alone, someone requests an experiment.

### Stage 5 — Experiment

The organization stops arguing and measures. A real spike runs in a sandbox: prototype, load test, benchmark, failure injection.

**Results land in the ledger as `tested` claims and settle the debate.** Experiments break ties, not seniority. This is the mechanism that keeps the organization evidence-driven rather than rhetoric-driven.

### Stage 6 — Architecture decision and gate

A decision is recorded with full structure: what was chosen, why, which alternatives were rejected, why they were rejected, who participated, and what evidence supports it.

The architecture gate evaluates. At Level 2 autonomy, the human approves.

### Stage 7 — Handoff to Engineering

**The handoff carries the ledger, not just the artifact.** Engineering inherits the requirements, the decision, the rejected alternatives and their reasons, the open risks, and the unresolved uncertainties.

This is the difference between an organization and an assembly line. Pipeline systems hand over a document and lose the reasoning; the receiving team then re-derives or contradicts it.

### Stage 8 — Implementation under continuous review

Engineering builds in real sandboxes: repositories, branches, CI, test infrastructure, cloud environments.

While they build, other teams watch — but selectively, driven by the attention router:

- **Deterministic triggers** (free): a benchmark reports 100ms against a 50ms requirement; a dependency with a known CVE is added; a gate that previously passed now fails; a file owned by Security changes.
- **Cheap triage**: a small model asks "does this event plausibly concern Security?" before waking the expensive specialist.
- **Full agent wake**: only when the above fire.

An interjection is not a chat message. It is a typed **objection** attached to the artifact, which enters the ledger and can block a gate. Security noticing an authorization flaw mid-build produces a real, tracked, blocking record — not a comment that scrolls away.

### Stage 9 — Verification

QA runs unit, integration, end-to-end, fuzz, and adversarial tests. Performance runs load and stress tests against the stated criteria. Security runs threat modeling and scans.

Failures do not merely file bugs. **A failure can falsify a claim the architecture rests on**, which reopens Stage 6. That is the loop the diagram's return arrow represents.

### Stage 10 — Release gate

Gates evaluate as queries over the ledger. All must pass. Human approval for release is the default at every autonomy level below 4.

### Stage 11 — Operate and feed back

Telemetry, incidents, and user feedback enter as new claims. Claims that contradict existing beliefs automatically open new proposals. The organization keeps working after launch.

### Stage 12 — Retrospective and HR cycle

The meta team evaluates: which decisions held up, which agents' objections proved correct, where the organization was slow, which model assignments underperformed. Proposals follow.

---

## 4. Four Rules That Make It An Organization, Not A Pipeline

Sequential multi-agent systems fail in a well-documented way: an early error propagates unchallenged through every downstream stage. These four rules are the defense.

1. **Handoffs carry context, not just artifacts.** The receiving team inherits reasoning, rejected options, and open risks.
2. **Downstream can reopen upstream.** An engineering discovery can falsify an architecture claim and reopen that decision. Decisions are durable but not immutable.
3. **Experiments outrank arguments.** When agents deadlock, the resolution path is measurement, not the more senior or more confident agent.
4. **Deadlock escalates rather than loops.** Debate has a budget and a convergence check. When it exhausts either, it goes up the ladder — never in circles.

---

## 5. Escalation Ladder

```
Agent disagreement
   ↓ unresolved after N rounds or budget exhausted
Team lead arbitrates
   ↓ cross-team conflict
Department heads negotiate
   ↓ conflicting objectives or requirement conflict
Org owner (you) decides
```

Escalation to a human is a designed outcome, not a failure. The deadlocks that reach you are precisely the decisions where judgment matters most — and you arrive with the full argument already structured rather than a wall of transcript.

---

## 6. Memory Architecture

Four tiers, each with a different scope and lifetime:

| Tier | Contains | Visible to |
|---|---|---|
| **Agent private** | Working notes, in-progress reasoning | That agent |
| **Personal assistant** | Owner's files, history, preferences | Owner only |
| **Team** | Team conventions, in-flight work, local decisions | Team members |
| **Organizational ledger** | Claims, decisions, requirements, experiments, artifacts | Org-wide, scoped by permission |

### The wiki

Human-readable documentation lives alongside everything else — but the critical design rule is:

**The wiki is generated from the ledger, not maintained beside it.**

A wiki maintained separately rots within weeks, because it is nobody's job and it drifts from reality. A wiki *projected* from the ledger cannot drift — the architecture page is a rendering of current architecture decisions and their supporting evidence. When a decision is reopened, the page updates.

Agents can write hand-authored narrative sections. But the factual spine — what we decided, what we tested, what we believe, what remains uncertain — is generated. You open the wiki and read the true current state of the product.

---

## 7. Reaching the Real World

Agents deliver real products, which means real access, scoped per agent and team:

- **Code** — GitHub/GitLab: repos, branches, PRs, reviews, issues
- **Build and test** — CI, test runners, fuzzers, coverage
- **Environments** — sandboxes, staging, ephemeral cloud environments, containers
- **Measurement** — load generators, benchmark harnesses, profilers, monitoring
- **Research** — web search, papers, documentation, competitor analysis
- **Data** — databases, object storage, datasets
- **Production** — deployment, rollback, incident response (highest permission tier)

Permissions are per-role and explicit: *this agent may research and code but not deploy; this team may deploy to staging, production requires human approval.* Spending limits are enforced per team and per objective, and an agent that exhausts its budget escalates rather than silently stopping.

---

## 8. Model and Harness Plurality

**Roles are separate from models.** A role defines responsibility; the model is the engine currently assigned to it, swappable without redesigning the role.

Deliberate assignment strategies:

- **Divergent proposals** — three different model families, independently, for genuinely different approaches
- **Adversarial review** — the reviewing agent runs a *different* model from the proposing agent, so it does not share the author's blind spots
- **Cost tiering** — cheap models for triage and routing, expensive models for architecture and final review
- **Specialization** — large-context models for whole-codebase work, reasoning models for architecture, fast models for classification

**Harnesses** — Claude Code, Codex, Gemini CLI, local runtimes — plug in as swappable execution backends behind a common adapter interface. An agent is `role → model → harness → tools → environment`, and any layer can be replaced independently.

---

## 9. Platform Feature Summary

**Communication**
Channels per team and project · threaded discussion · @-mention humans, agents, and assistants · presence and live activity · notifications and subscriptions · typed decision pages · full-text and semantic search across all history

**Organization**
Multiple organizations · departments and teams · team and agent templates ("storage engine company", "OS team") with built-in protocols · roles and permissions · autonomy levels 1–4 · budgets per team and objective

**Agents**
Independent agents and personal assistants · role/model/harness separation · per-agent tools and permissions · persistent memory · performance history · installable agent packages

**Work**
Objectives with measurable success criteria · projects and milestones · products, services, and experiments as durable first-class objects · requirements · decisions with rejected alternatives · risk register

**Deliberation**
Structured proposals · evidence attachment · typed objections · auto-assigned debate roles · experiment requests · configurable quality gates · escalation ladder

**Knowledge**
Four-tier memory · epistemic ledger with claim status · knowledge graph across all entities · generated wiki · full audit trail and replay

**Execution**
Sandboxes · repository and CI integration · benchmark and load-test harnesses · cloud environments · web and research access · deployment with rollback

**Meta**
HR/meta team · agent evaluation on ledger-derived metrics · reassignment, promotion, retirement, and hiring proposals · model swap recommendations · organizational retrospectives

---

## 10. Where This Workflow Is Most Likely To Break

Stated plainly, because these are the things to test before building the rest.

1. **Divergent proposals may converge anyway.** Different model families still share enormous overlap in training data. If three "independent" proposals come back structurally identical, the central premise weakens. *Test this first — it is cheap and it is decisive.*

2. **Continuous review may become noise.** If the attention router over-fires, every build event triggers four specialists and the channel becomes unreadable and unaffordable. If it under-fires, the review value disappears. There is a narrow band to hit.

3. **The escalation ladder may route everything to you.** If agents deadlock frequently, you become the bottleneck the product was supposed to eliminate. Watch escalation rate as a primary health metric.

4. **Handoff fidelity may not survive.** Carrying the ledger forward is the design, but context windows are finite. What gets summarized at each boundary, and what is lost, is an unsolved engineering problem.

5. **Real-world access is the largest risk surface.** An agent with repository write access, cloud credentials, and a budget can do real damage. Permission scoping and sandboxing are not v2 features — they gate whether you can safely run stage 8 at all.
