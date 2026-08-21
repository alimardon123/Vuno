// AI Org OS — POST /api/objective
// File a new objective: validate body (zod), create Objective row, append
// ObjectiveFiled event to the spine (scopeType=channel, scopeId=ch-storage)
// so the chat projection picks it up.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  successCriteria: z.string().min(1).max(500),
  constraints: z.string().max(500).optional().nullable(),
  budget: z.string().max(120).optional().nullable(),
  autonomyLevel: z.enum(['L1', 'L2', 'L3', 'L4']).default('L2'),
  owningDepartment: z.string().max(120).optional().nullable(),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = (await req.json()) as unknown;
    parsed = bodySchema.parse(json);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Invalid body' },
      { status: 400 },
    );
  }

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, tenantId: true },
  });
  if (!org) {
    return NextResponse.json(
      { ok: false, error: 'No organization found. Seed the database first.' },
      { status: 409 },
    );
  }

  // Create the Objective row.
  const objective = await db.objective.create({
    data: {
      tenantId: org.tenantId,
      orgId: org.id,
      title: parsed.title,
      successCriteria: parsed.successCriteria,
      constraints: parsed.constraints ?? null,
      budget: parsed.budget ?? null,
      autonomyLevel: parsed.autonomyLevel,
      status: 'filed',
      owningDepartment: parsed.owningDepartment ?? null,
    },
  });

  // Append ObjectiveFiled to the channel scope so chat picks it up.
  // v1: route to the first known channel in the org (the seeded #storage-engine).
  const channel = await db.channel.findFirst({
    where: { orgId: org.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  const scopeId = channel?.id ?? org.id;
  const scopeType = channel ? 'channel' : 'org';

  const spine = new EventSpine(org.tenantId, org.id);
  const eventInput: NewEventInput<'ObjectiveFiled'> = {
    type: 'ObjectiveFiled',
    actorType: 'human',
    scopeType,
    scopeId,
    payload: {
      objectiveId: objective.id,
      title: objective.title,
      successCriteria: objective.successCriteria,
      constraints: objective.constraints ?? undefined,
      budget: objective.budget ?? undefined,
      autonomyLevel: objective.autonomyLevel,
      owningDepartment: objective.owningDepartment ?? undefined,
    },
  };
  await spine.append([eventInput]);

  return NextResponse.json({ ok: true, objective });
}
