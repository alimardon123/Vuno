// Vuno — the objective lifecycle (ADR-0007)
//
// The workflow doc's twelve stages, as data. Each stage declares what work it
// enqueues on entry and what has to be true before the objective may advance.
// The orchestrator reads this table; nothing else decides what happens next.
//
// Only the first stages are wired. The rest are declared with `implemented:
// false` so the shape is visible and adding one is filling in a handler rather
// than inventing a mechanism.

export type Stage =
  | 'filed'
  | 'routing'
  | 'problem_definition'
  | 'divergent_proposal'
  | 'debate'
  | 'experiment'
  | 'decision'
  | 'handoff'
  | 'implementation'
  | 'verification'
  | 'release'
  | 'operating'
  | 'retrospective'
  | 'shipped'
  | 'killed';

export interface StageSpec {
  /** What the orchestrator does on entering this stage. */
  enqueues: { kind: string; role?: string; count?: number }[];
  /** Where it goes when that work completes. */
  next: Stage | null;
  implemented: boolean;
  /** Shown on the objective page, in the owner's words rather than the code's. */
  label: string;
  description: string;
}

export const STAGES: Record<Stage, StageSpec> = {
  filed: {
    label: 'Filed',
    description: 'Waiting to be routed to a department.',
    enqueues: [{ kind: 'route_objective' }],
    next: 'routing',
    implemented: true,
  },
  routing: {
    label: 'Routing',
    description: 'Picking the owning department and assembling a working group.',
    enqueues: [{ kind: 'assemble_working_group' }],
    next: 'problem_definition',
    implemented: true,
  },
  problem_definition: {
    label: 'Defining the problem',
    description:
      'Product and Research interrogate the objective: what is ambiguous, what already exists, what has been tried.',
    enqueues: [
      { kind: 'interrogate_objective', role: 'product' },
      { kind: 'interrogate_objective', role: 'research' },
    ],
    next: 'divergent_proposal',
    implemented: true,
  },
  divergent_proposal: {
    label: 'Divergent proposals',
    description:
      'Independent approaches, written without seeing each other, deliberately across different model families.',
    enqueues: [{ kind: 'propose', count: 3 }],
    next: 'debate',
    implemented: false,
  },
  debate: {
    label: 'Debate',
    description: 'Proposals published together and contested. Evidence outranks assertion.',
    enqueues: [{ kind: 'review_proposals' }],
    next: 'experiment',
    implemented: false,
  },
  experiment: {
    label: 'Experiment',
    description: 'The organisation stops arguing and measures.',
    enqueues: [{ kind: 'run_experiment' }],
    next: 'decision',
    implemented: false,
  },
  decision: {
    label: 'Decision',
    description: 'What was chosen, why, what was rejected and on what evidence.',
    enqueues: [{ kind: 'record_decision' }],
    next: 'handoff',
    implemented: false,
  },
  handoff: {
    label: 'Handoff',
    description: 'Engineering inherits the ledger, not just the artifact.',
    enqueues: [{ kind: 'handoff_to_engineering' }],
    next: 'implementation',
    implemented: false,
  },
  implementation: {
    label: 'Implementation',
    description: 'Building, under continuous review from the attention router.',
    enqueues: [{ kind: 'implement' }],
    next: 'verification',
    implemented: false,
  },
  verification: {
    label: 'Verification',
    description: 'QA, performance and security test against the stated criteria.',
    enqueues: [{ kind: 'verify' }],
    next: 'release',
    implemented: false,
  },
  release: {
    label: 'Release gate',
    description: 'Gates evaluate as queries over the ledger. A human approves.',
    enqueues: [{ kind: 'evaluate_release_gate' }],
    next: 'operating',
    implemented: false,
  },
  operating: {
    label: 'Operating',
    description: 'Telemetry and incidents enter as new claims. The work continues after launch.',
    enqueues: [],
    next: 'retrospective',
    implemented: false,
  },
  retrospective: {
    label: 'Retrospective',
    description: 'HR evaluates which decisions held up and whose objections proved correct.',
    enqueues: [{ kind: 'retrospective' }],
    next: 'shipped',
    implemented: false,
  },
  shipped: {
    label: 'Shipped',
    description: 'Success criteria met.',
    enqueues: [],
    next: null,
    implemented: true,
  },
  killed: {
    label: 'Killed',
    description: 'Stopped deliberately, with the reason recorded.',
    enqueues: [],
    next: null,
    implemented: true,
  },
};

export const STAGE_ORDER: Stage[] = [
  'filed', 'routing', 'problem_definition', 'divergent_proposal', 'debate',
  'experiment', 'decision', 'handoff', 'implementation', 'verification',
  'release', 'operating', 'retrospective', 'shipped',
];

export function isStage(value: string): value is Stage {
  return value in STAGES;
}

/** How far along an objective is, for a progress indicator. */
export function stageProgress(stage: Stage): { index: number; total: number } {
  const index = STAGE_ORDER.indexOf(stage);
  return { index: index < 0 ? 0 : index, total: STAGE_ORDER.length - 1 };
}
