// Vuno — POST /api/install
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
  // Required when kind is personal_assistant: the member this assistant works for.
  ownerMemberId: z.string().optional().nullable(),
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

  // Installing an agent creates a Member with an agent profile — the same row
  // shape a human gets. Nothing about installation is agent-specific except the
  // profile that hangs off it (ADR-0009).
  const handle = parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  const member = await db.member.create({
    data: {
      tenantId: org.tenantId,
      orgId: org.id,
      kind: 'agent',
      displayName: parsed.name,
      handle,
      teamId: parsed.teamId ?? null,
      status: 'active',
      presenceState: 'available',
      agent: {
        create: {
          role: parsed.role,
          modelName: parsed.modelName,
          harnessName: parsed.harnessName,
          tools: JSON.stringify(parsed.tools),
          permissions: JSON.stringify(parsed.permissions),
          ownerMemberId: parsed.kind === 'personal_assistant' ? parsed.ownerMemberId ?? null : null,
        },
      },
    },
    include: { agent: true },
  });
  const agent = {
    id: member.id,
    name: member.displayName,
    role: parsed.role,
    kind: parsed.kind,
    modelName: parsed.modelName,
    harnessName: parsed.harnessName,
  };

  const spine = new EventSpine(org.tenantId, org.id);
  const eventInput: NewEventInput<'AgentInstalled'> = {
    type: 'AgentInstalled',
    actorType: 'member',
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
