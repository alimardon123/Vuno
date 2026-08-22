import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';

export const dynamic = 'force-dynamic';

// GET /api/decisions/<id>
// Returns decision + project + decision-scoped events + project-scoped events
// (for risks/gates display) + gates.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org)
    return NextResponse.json({
      decision: null,
      project: null,
      events: [],
      projectEvents: [],
      gates: [],
    });

  const decision = await db.decision.findUnique({
    where: { id },
  });
  if (!decision || decision.orgId !== org.id) {
    return NextResponse.json({
      decision: null,
      project: null,
      events: [],
      projectEvents: [],
      gates: [],
    });
  }

  const project = await db.project.findUnique({
    where: { id: decision.projectId },
  });
  const spine = new EventSpine(org.tenantId, org.id);
  const events = await spine.replay({
    scopeType: 'decision',
    scopeId: id,
    limit: 500,
  });
  const projectEvents = project
    ? await spine.replay({
        scopeType: 'project',
        scopeId: project.id,
        limit: 500,
      })
    : [];
  const gates = await db.gate.findMany({
    where: { decisionId: id },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({
    decision,
    project,
    events,
    projectEvents,
    gates,
  });
}
