// Vuno — GET /api/objectives
// The Work surface. An objective with where it is, what is queued, what has run
// and what it cost — the thing the product description centres on and that had
// no surface at all before now.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { memberMap } from '@/lib/members';
import { isStage, STAGES, stageProgress } from '@/lib/orchestrator/stages';

export const dynamic = 'force-dynamic';

export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ objectives: [] });

  const objectives = await db.objective.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: 'desc' },
  });

  const [items, sessions] = await Promise.all([
    db.workItem.findMany({
      where: { orgId: org.id, objectiveId: { in: objectives.map((o) => o.id) } },
      orderBy: { createdAt: 'asc' },
    }),
    db.workSession.findMany({
      where: { orgId: org.id },
      orderBy: { startedAt: 'desc' },
      take: 200,
    }),
  ]);

  const members = await memberMap(sessions.map((s) => s.memberId));

  return NextResponse.json({
    objectives: objectives.map((o) => {
      const stage = isStage(o.stage) ? o.stage : 'filed';
      const spec = STAGES[stage];
      const mine = items.filter((i) => i.objectiveId === o.id);
      const mySessions = sessions.filter((s) => mine.some((i) => i.id === s.workItemId));

      return {
        id: o.id,
        title: o.title,
        successCriteria: o.successCriteria,
        constraints: o.constraints,
        budget: o.budget,
        autonomyLevel: o.autonomyLevel,
        status: o.status,
        owningDepartment: o.owningDepartment,
        createdAt: o.createdAt,
        stage: {
          key: stage,
          label: spec.label,
          description: spec.description,
          implemented: spec.implemented,
          enteredAt: o.stageEnteredAt,
          ...stageProgress(stage),
        },
        work: {
          pending: mine.filter((i) => i.state === 'pending').length,
          running: mine.filter((i) => i.state === 'leased').length,
          done: mine.filter((i) => i.state === 'done').length,
          failed: mine.filter((i) => i.state === 'failed').length,
        },
        // What actually ran, and what it cost. Real numbers, not estimates.
        sessions: mySessions.slice(0, 20).map((s) => {
          const m = members.get(s.memberId);
          return {
            id: s.id,
            member: m ? { id: m.id, name: m.displayName, kind: m.kind, role: m.role } : null,
            kind: mine.find((i) => i.id === s.workItemId)?.kind ?? 'unknown',
            outcome: s.outcome,
            durationMs: s.durationMs,
            costCents: s.costCents,
            startedAt: s.startedAt,
            error: s.error,
          };
        }),
        costCents: mySessions.reduce((sum, s) => sum + s.costCents, 0),
      };
    }),
  });
}
