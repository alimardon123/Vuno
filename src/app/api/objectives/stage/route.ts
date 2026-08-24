// Vuno — POST /api/objectives/stage
//
// Moving a card on the board. The one place a person overrides the runtime, so
// it is a request with a reason rather than a silent column write — and it goes
// through `moveObjective`, which appends the event and enqueues the destination
// stage's work exactly as the orchestrator does.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { takeWrite } from '@/lib/limits';
import { BoardError, moveObjective } from '@/lib/work/board';
import { isStage } from '@/lib/orchestrator/stages';

export const dynamic = 'force-dynamic';

const body = z.object({
  objectiveId: z.string().min(1),
  to: z.string().min(1).refine(isStage, { message: 'that is not a stage' }),
  reason: z.string().max(400).optional(),
});

export async function POST(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const rate = takeWrite(`stage:${viewer.id}`);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: `Slow down for ${rate.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  try {
    const parsed = body.parse((await req.json()) as unknown);
    const moved = await moveObjective({
      tenantId: org.tenantId,
      orgId: org.id,
      objectiveId: parsed.objectiveId,
      to: parsed.to,
      actor: viewer,
      reason: parsed.reason,
    });
    return NextResponse.json({ ok: true, ...moved });
  } catch (e) {
    if (e instanceof BoardError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: e.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
    }
    throw e;
  }
}
