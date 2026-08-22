// Vuno — POST /api/messages
// Post a MessagePosted event to a channel scope.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  body: z.string().min(1).max(4000),
  channelId: z.string().min(1),
  actorType: z.enum(['agent', 'human', 'system']).default('human'),
  actorAgentId: z.string().optional(),
  actorUserId: z.string().optional(),
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

  const channel = await db.channel.findFirst({
    where: { id: parsed.channelId, orgId: org.id },
    select: { id: true },
  });
  if (!channel) {
    return NextResponse.json(
      { ok: false, error: 'Unknown channel for this org.' },
      { status: 400 },
    );
  }

  const spine = new EventSpine(org.tenantId, org.id);
  const eventInput: NewEventInput<'MessagePosted'> = {
    type: 'MessagePosted',
    actorType: parsed.actorType,
    actorAgentId: parsed.actorAgentId,
    actorUserId: parsed.actorUserId ?? 'user-kai',
    scopeType: 'channel',
    scopeId: channel.id,
    payload: { body: parsed.body },
  };
  const [created] = await spine.append([eventInput]);
  return NextResponse.json({ ok: true, event: created });
}
