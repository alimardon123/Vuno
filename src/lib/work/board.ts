// Vuno — the board.
//
// Not a second to-do system. Every card on it is an objective that already
// exists, in the stage it is already in — the board is an arrangement of the
// org's real work, not a parallel place to write down intentions that nothing
// acts on. A board whose cards are only cards is the same failure as an agent
// with canned replies: it looks like work is happening.
//
// Moving a card is therefore a real thing to have done, and the one place a
// person's judgment overrides the runtime. ADR-0007 says the orchestrator owns
// `stage`; this does not go around that. It records why the objective moved,
// enqueues what the destination stage declares, and leaves the orchestrator to
// carry on from there — the same entry path the orchestrator uses itself.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { enqueueStageWork } from '@/lib/orchestrator/runner';
import { isStage, STAGES, STAGE_ORDER, type Stage } from '@/lib/orchestrator/stages';
import type { MemberSummary } from '@/lib/members';

export class BoardError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BoardError';
  }
}

export interface BoardCard {
  id: string;
  title: string;
  successCriteria: string;
  stage: Stage;
  status: string;
  autonomyLevel: string;
  owningDepartment: string | null;
  /** How long it has sat here. The number that says something is stuck. */
  stageEnteredAt: string;
  /** Work the orchestrator is doing on it right now. */
  running: number;
  pending: number;
  /** Gates on its projects that are blocking, with what they said. */
  blocked: Array<{ name: string; reason: string | null }>;
}

export interface BoardColumn {
  stage: Stage;
  label: string;
  description: string;
  /** False for a stage the orchestrator cannot run yet — the card would sit. */
  implemented: boolean;
  cards: BoardCard[];
}

/**
 * The board, in stage order.
 *
 * `shipped` and `killed` are the two ends and always appear; every other stage
 * appears only when the twelve-column wall would otherwise be mostly empty —
 * an empty column for a stage this org has never reached is a column that
 * teaches nothing and costs a screen width.
 */
export async function board(orgId: string): Promise<BoardColumn[]> {
  const [objectives, items, gates] = await Promise.all([
    db.objective.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } }),
    db.workItem.findMany({
      where: { orgId, state: { in: ['pending', 'leased'] } },
      select: { objectiveId: true, state: true },
    }),
    db.gate.findMany({
      where: { orgId, state: 'blocked' },
      select: { name: true, reason: true, project: { select: { objectiveId: true } } },
    }),
  ]);

  const cards = objectives.map((o): BoardCard => {
    const mine = items.filter((i) => i.objectiveId === o.id);
    return {
      id: o.id,
      title: o.title,
      successCriteria: o.successCriteria,
      stage: isStage(o.stage) ? o.stage : 'filed',
      status: o.status,
      autonomyLevel: o.autonomyLevel,
      owningDepartment: o.owningDepartment,
      stageEnteredAt: o.stageEnteredAt.toISOString(),
      running: mine.filter((i) => i.state === 'leased').length,
      pending: mine.filter((i) => i.state === 'pending').length,
      blocked: gates
        .filter((g) => g.project?.objectiveId === o.id)
        .map((g) => ({ name: g.name, reason: g.reason })),
    };
  });

  const occupied = new Set(cards.map((c) => c.stage));

  // `killed` is not in `STAGE_ORDER` — that list is the path an objective takes
  // when it works, and killed is an exit from it. Left out, a killed objective
  // would have no column and simply disappear from the board, which is how a
  // decision to stop something becomes invisible.
  const wall: Stage[] = [...STAGE_ORDER, 'killed'];

  return wall
    .filter((stage) => occupied.has(stage) || stage === 'filed' || stage === 'shipped' || stage === 'killed')
    .map((stage) => ({
      stage,
      label: STAGES[stage].label,
      description: STAGES[stage].description,
      implemented: STAGES[stage].implemented,
      cards: cards.filter((c) => c.stage === stage),
    }));
}

/**
 * Move an objective, because a person decided to.
 *
 * The escalation ladder exists so a person is asked only where judgment
 * genuinely matters — and when they answer, the answer has to be actionable.
 * So this is not a column write: it records the move as an event with the
 * reason attached, then enqueues what the destination declares, exactly as the
 * orchestrator would on entering that stage. The runtime picks it up from
 * there without knowing a human was involved.
 */
export async function moveObjective(input: {
  tenantId: string;
  orgId: string;
  objectiveId: string;
  to: Stage;
  actor: MemberSummary;
  reason?: string;
}): Promise<{ from: Stage; to: Stage }> {
  const objective = await db.objective.findFirst({
    where: { id: input.objectiveId, orgId: input.orgId },
  });
  if (!objective) throw new BoardError('That objective is not in this org.', 404);

  const from: Stage = isStage(objective.stage) ? objective.stage : 'filed';
  if (from === input.to) return { from, to: from };

  if (!isStage(input.to)) throw new BoardError(`"${input.to}" is not a stage.`);

  // Not a refusal — a warning would be, and this is a real dead end. A card
  // dropped into a stage nothing can run sits there looking like work.
  if (!STAGES[input.to].implemented && input.to !== 'shipped' && input.to !== 'killed') {
    throw new BoardError(
      `${STAGES[input.to].label} is designed but not built, so an objective moved there would stop. ` +
        `Move it to a stage the orchestrator can run, or to Shipped or Killed.`,
    );
  }

  // The event first: if the enqueue fails, the record still says what was
  // decided and by whom. The other order loses the decision.
  await new EventSpine(objective.tenantId, input.orgId).append([
    {
      type: 'ObjectiveStageChanged',
      actorType: 'member',
      actorMemberId: input.actor.id,
      scopeType: 'objective',
      scopeId: input.objectiveId,
      payload: {
        objectiveId: input.objectiveId,
        from,
        to: input.to,
        reason: input.reason?.trim() || `Moved on the board by ${input.actor.displayName}.`,
        byHand: true,
      },
    },
  ]);

  await db.objective.update({
    where: { id: input.objectiveId },
    data: {
      stage: input.to,
      stageEnteredAt: new Date(),
      // Shipped and killed are terminal, and the status column is what every
      // other surface filters on. Leaving it `active` on a killed objective is
      // how something dead keeps showing up in Activity.
      ...(input.to === 'shipped' ? { status: 'shipped' } : {}),
      ...(input.to === 'killed' ? { status: 'killed' } : {}),
      ...(input.to !== 'shipped' && input.to !== 'killed' && objective.status === 'filed'
        ? { status: 'active' }
        : {}),
    },
  });

  // Terminal stages declare no work, so there is nothing to enqueue and asking
  // would create an item nothing drains.
  if (input.to !== 'shipped' && input.to !== 'killed') {
    await enqueueStageWork(objective.tenantId, input.orgId, input.objectiveId, input.to);
  }

  return { from, to: input.to };
}
