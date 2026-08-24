// Vuno — the orchestrator loop (ADR-0007)
//
// The thing that did not exist. Before this, every agent action lived inside an
// HTTP request: close the tab and the organisation stopped. This runs as its
// own process, so an objective keeps moving when nobody is looking.
//
// One loop, and it is deliberately boring:
//   claim → run the handler → append what happened → advance the stage →
//   enqueue what comes next → release
//
// It holds no state of its own. Everything it knows is in the database, which
// is why killing it mid-run loses nothing but time.

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { claimNext, complete, enqueue, fail, heartbeat, LEASE_MS } from './queue';
import { handlerFor, nextStage } from './handlers';
import { EventSpine } from '@/lib/events/spine';
import { isStage, STAGES, type Stage } from './stages';

export interface RunnerOptions {
  orgId: string;
  /** Identifies this worker in the lease. Defaults to a fresh id per process. */
  workerId?: string;
  /** How long to wait when there is nothing to do. */
  idleMs?: number;
  /** Stop after this many items. Used by tests; unset means run forever. */
  maxItems?: number;
  onLog?: (line: string) => void;
}

export interface TickResult {
  handled: boolean;
  itemId?: string;
  kind?: string;
  summary?: string;
  advancedTo?: Stage;
  error?: string;
}

/**
 * Run exactly one item, if one is available. Separated from the loop so tests
 * can drive the orchestrator deterministically rather than racing a timer.
 */
export async function tick(opts: { orgId: string; workerId: string; onLog?: (l: string) => void }): Promise<TickResult> {
  const log = opts.onLog ?? (() => {});
  const item = await claimNext({ orgId: opts.orgId, workerId: opts.workerId });
  if (!item) return { handled: false };

  log(`→ ${item.kind} (${item.id}) attempt ${item.attempts}`);

  // The session is opened before the work runs, so a crash leaves an
  // 'abandoned' row rather than no trace that anything was tried.
  const session = await db.workSession.create({
    data: {
      tenantId: item.tenantId,
      orgId: item.orgId,
      workItemId: item.id,
      memberId: item.assigneeId ?? 'system',
      outcome: 'running',
    },
  });
  const startedAt = Date.now();

  // Long handlers keep the lease alive rather than letting another worker
  // pick up work that is still in progress.
  const beat = setInterval(() => {
    void heartbeat(item.id, opts.workerId);
  }, Math.floor(LEASE_MS / 3));

  try {
    const result = await handlerFor(item.kind)(item);
    clearInterval(beat);

    // Every run records what it cost, including the ones that cost nothing —
    // "Efficient: every run records its cost" is only checkable if the zero
    // ones are recorded too.
    await db.workSession.update({
      where: { id: session.id },
      data: {
        memberId: result.memberId ?? item.assigneeId ?? 'system',
        outcome: 'succeeded',
        endedAt: new Date(),
        durationMs: Date.now() - startedAt,
        costCents: result.usage?.costCents ?? 0,
        tokensIn: result.usage?.tokensIn ?? null,
        tokensOut: result.usage?.tokensOut ?? null,
        modelName: result.usage?.modelName ?? null,
        harnessName: result.usage?.harnessName ?? null,
      },
    });

    await complete(item.id, opts.workerId, { summary: result.summary });
    log(`  ✓ ${result.summary}`);

    let advancedTo: Stage | undefined;
    if (result.advance && item.objectiveId) {
      advancedTo = (await advanceObjective(item.objectiveId, log)) ?? undefined;
    }

    return { handled: true, itemId: item.id, kind: item.kind, summary: result.summary, advancedTo };
  } catch (err) {
    clearInterval(beat);
    const message = err instanceof Error ? err.message : String(err);

    await db.workSession.update({
      where: { id: session.id },
      data: {
        outcome: 'failed',
        error: message.slice(0, 2000),
        endedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });

    // A handler marks a failure permanent when no number of retries can fix it.
    const permanent = Boolean((err as { permanent?: boolean } | null)?.permanent);
    const disposition = await fail(item.id, opts.workerId, message, permanent);
    log(`  ✗ ${message} (${disposition})`);
    return { handled: true, itemId: item.id, kind: item.kind, error: message };
  }
}

/**
 * Move an objective to the next stage and enqueue that stage's work — but only
 * once every item for the current stage has finished. A stage that fans out to
 * three proposals waits for all three.
 */
async function advanceObjective(objectiveId: string, log: (l: string) => void): Promise<Stage | null> {
  const objective = await db.objective.findUnique({ where: { id: objectiveId } });
  if (!objective) return null;

  const outstanding = await db.workItem.count({
    where: { objectiveId, state: { in: ['pending', 'leased'] } },
  });
  if (outstanding > 0) return null;

  const current: Stage = isStage(objective.stage) ? objective.stage : 'filed';
  const next = nextStage(current);
  if (!next) return null;

  // The event before the column. Until this existed, the spine could replay
  // every message in the org and not say how a piece of work reached the stage
  // it is in — the one question the stage column exists to answer. The board's
  // by-hand moves append the same type, so both paths read back the same way.
  await new EventSpine(objective.tenantId, objective.orgId).append([
    {
      type: 'ObjectiveStageChanged',
      actorType: 'system',
      scopeType: 'objective',
      scopeId: objectiveId,
      payload: {
        objectiveId,
        from: current,
        to: next,
        reason: `Every work item for ${current} finished.`,
        byHand: false,
      },
    },
  ]);

  await db.objective.update({
    where: { id: objectiveId },
    data: { stage: next, stageEnteredAt: new Date() },
  });
  log(`  ⇢ ${current} → ${next}`);

  await enqueueStageWork(objective.tenantId, objective.orgId, objectiveId, next);
  return next;
}

/** Enqueue everything a stage declares on entry. */
export async function enqueueStageWork(
  tenantId: string,
  orgId: string,
  objectiveId: string,
  stage: Stage,
): Promise<number> {
  const spec = STAGES[stage];
  if (!spec) return 0;

  let queued = 0;
  for (const step of spec.enqueues) {
    const count = step.count ?? 1;
    for (let i = 0; i < count; i++) {
      const suffix = step.role ? `:${step.role}` : count > 1 ? `:${i}` : '';
      const { created } = await enqueue({
        tenantId,
        orgId,
        kind: step.kind,
        subjectType: 'objective',
        subjectId: objectiveId,
        objectiveId,
        dedupeKey: `${stage}:${objectiveId}:${step.kind}${suffix}`,
        input: step.role ? { role: step.role } : {},
      });
      if (created) queued++;
    }
  }
  return queued;
}

/** The loop. Runs until stopped, or until `maxItems` have been handled. */
export async function run(opts: RunnerOptions): Promise<void> {
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const idleMs = opts.idleMs ?? 1000;
  const log = opts.onLog ?? ((l: string) => console.log(`[orchestrator] ${l}`));

  let handled = 0;
  let stopping = false;
  const stop = () => {
    stopping = true;
    log('stopping after the current item');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  log(`started as ${workerId} for org ${opts.orgId}`);

  while (!stopping) {
    const result = await tick({ orgId: opts.orgId, workerId, onLog: log });
    if (result.handled) {
      handled++;
      if (opts.maxItems && handled >= opts.maxItems) break;
      continue; // drain the queue before idling
    }
    await new Promise((r) => setTimeout(r, idleMs));
  }

  log(`stopped after ${handled} item(s)`);
}
