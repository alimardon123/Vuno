// AI Org OS — POST /api/install
// Install a new agent: validate body (zod), create Agent row, append AgentInstalled
// event to the spine (actorType='human', scopeType='org', scopeId=org.id).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['independent', 'personal_assistant']),
  role: z.string().min(1).max(60),
  modelName: z.string().min(1).max(120).default('simulated/echo-1'),
  harnessName: z.string().min(1).max(120).default('simulated'),
  tools: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  teamId: z.string().optional().nullable(),
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

  // Resolve team (optional) and team name for the event payload.
  let teamName: string | undefined;
  if (parsed.teamId) {
    const team = await db.team.findUnique({
      where: { id: parsed.teamId },
      select: { id: true, name: true, orgId: true },
    });
    if (!team || team.orgId !== org.id) {
      return NextResponse.json(
        { ok: false, error: 'Unknown team for this org.' },
        { status: 400 },
      );
    }
    teamName = team.name;
  }

  // Create the Agent row.
  const agent = await db.agent.create({
    data: {
      tenantId: org.tenantId,
      orgId: org.id,
      name: parsed.name,
      kind: parsed.kind,
      role: parsed.role,
      modelName: parsed.modelName,
      harnessName: parsed.harnessName,
      tools: JSON.stringify(parsed.tools),
      permissions: JSON.stringify(parsed.permissions),
      teamId: parsed.teamId ?? null,
      status: 'active',
    },
  });

  // Append the AgentInstalled event to the spine (org-scoped).
  const spine = new EventSpine(org.tenantId, org.id);
  const eventInput: NewEventInput<'AgentInstalled'> = {
    type: 'AgentInstalled',
    actorType: 'human',
    scopeType: 'org',
    scopeId: org.id,
    payload: {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      kind: agent.kind === 'personal_assistant' ? 'personal_assistant' : 'independent',
      modelName: agent.modelName,
      harnessName: agent.harnessName,
      teamId: parsed.teamId ?? undefined,
      teamName,
    },
  };
  await spine.append([eventInput]);

  return NextResponse.json({
    ok: true,
    agent: {
      ...agent,
      tools: parsed.tools,
      permissions: parsed.permissions,
    },
  });
}
