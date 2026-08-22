// Vuno — POST /api/messages
// Post a MessagePosted event to a channel scope.
// Also broadcasts via socket.io + triggers the attention router + memory
// evolution (the collaboration loop). Per the "Functional" principle: regular
// user messages via the composer MUST trigger the collaboration loop, not just
// direct API calls to /api/events.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { broadcastEventAppended } from '@/lib/realtime/broadcast';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  body: z.string().min(1).max(4000),
  channelId: z.string().min(1),
  actorType: z.enum(['agent', 'human', 'system']).default('human'),
  actorAgentId: z.string().optional(),
  actorUserId: z.string().optional(),
  useRealLLM: z.boolean().optional(), // forwarded to attention-router + memory-evolution
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

  // Broadcast via socket.io for real-time UI update
  void broadcastEventAppended({
    channelId: channel.id,
    scopeType: 'channel',
    scopeId: channel.id,
    event: created,
  });

  // Trigger the collaboration loop — attention router + memory evolution.
  // Same pattern as /api/events POST. Fire-and-forget (Performant principle).
  if (parsed.actorType === 'human') {
    const eventId = created.id;
    const messageBody = parsed.body;
    const channelId = channel.id;
    const useRealLLM = parsed.useRealLLM;

    // Attention router
    void fetch('http://localhost:3000/api/attention-router', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageEventId: eventId, body: messageBody, channelId, useRealLLM }),
    }).catch((err) => console.warn('[messages] attention router trigger failed:', err));

    // Memory evolution — resolve the org owner (Kai)
    void db.user.findFirst({
      where: { tenantId: org.tenantId, isOrgOwner: true },
      select: { id: true },
    }).then((ownerUser) => {
      if (ownerUser) {
        return fetch('http://localhost:3000/api/memory-evolution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageEventId: eventId, body: messageBody, channelId, ownerUserId: ownerUser.id, useRealLLM }),
        });
      }
      return null;
    }).catch((err) => console.warn('[messages] memory evolution trigger failed:', err));
  }

  return NextResponse.json({ ok: true, event: created });
}
