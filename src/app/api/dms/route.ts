// Vuno — POST /api/dms
// Get-or-create a DM channel between the current user (Kai) and another member
// (agent or human). Per the "Functional" principle: real DMs, not fake scopes.
//
// Flow:
//   1. Receive { withMemberId } — the agent or user to DM with
//   2. Compute a deterministic DM channel slug: dm-{a}-{b} (sorted)
//   3. Find or create the channel (isDm=true, teamId=null)
//   4. Return the channel — the Chats panel sets it as active

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  withMemberId: z.string().min(1),
  withMemberKind: z.enum(['agent', 'human']).default('agent'),
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
    return NextResponse.json({ ok: false, error: 'No organization found' }, { status: 400 });
  }

  // Resolve the current user (org owner = Kai in v1)
  const owner = await db.user.findFirst({
    where: { tenantId: org.tenantId, isOrgOwner: true },
    select: { id: true, name: true, email: true },
  });
  if (!owner) {
    return NextResponse.json({ ok: false, error: 'No org owner found' }, { status: 400 });
  }

  // Resolve the target member's name (for the DM channel name)
  let targetName: string;
  if (parsed.withMemberKind === 'agent') {
    const agent = await db.agent.findUnique({
      where: { id: parsed.withMemberId },
      select: { name: true },
    });
    targetName = agent?.name ?? 'Unknown';
  } else {
    const user = await db.user.findUnique({
      where: { id: parsed.withMemberId },
      select: { name: true, email: true },
    });
    targetName = user?.name ?? user?.email ?? 'Unknown';
  }

  // Deterministic slug: sort the two IDs so dm-a-b == dm-b-a
  const ids = [owner.id, parsed.withMemberId].sort();
  const slug = `dm-${ids[0]}-${ids[1]}`;
  const channelId = `ch-${slug}`;

  // Find or create the DM channel
  const existing = await db.channel.findUnique({ where: { id: channelId } });
  if (existing) {
    return NextResponse.json({ ok: true, channel: existing });
  }

  // Create a new DM channel (isDm=true, no team)
  const channel = await db.channel.create({
    data: {
      id: channelId,
      tenantId: org.tenantId,
      orgId: org.id,
      teamId: null,
      name: targetName,
      slug,
      topic: `Direct message with ${targetName}`,
      isDm: true,
    },
  });

  return NextResponse.json({ ok: true, channel });
}
