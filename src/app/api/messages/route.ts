// Vuno — POST /api/messages
// Post a MessagePosted event to a channel scope.
// Also broadcasts via socket.io + triggers the attention router + memory
// evolution (the collaboration loop). Per the "Functional" principle: regular
// user messages via the composer MUST trigger the collaboration loop, not just
// direct API calls to /api/events.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { originFrom } from '@/lib/origin';
import { getMember, getOrgOwner } from '@/lib/members';
import { EventSpine } from '@/lib/events/spine';
import { broadcastEventAppended } from '@/lib/realtime/broadcast';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  body: z.string().min(1).max(4000),
  channelId: z.string().min(1),
  actorType: z.enum(['member', 'system']).default('member'),
  actorMemberId: z.string().optional(),
  onBehalfOfMemberId: z.string().optional(),
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
    actorMemberId: parsed.actorMemberId,
    onBehalfOfMemberId: parsed.onBehalfOfMemberId,
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
  // Wake the org only when a person posted. An agent's own message must not
  // re-enter the router, or agents wake each other in a loop. The kind lives on
  // the member record now, not on the event (ADR-0009).
  const poster = parsed.actorMemberId ? await getMember(parsed.actorMemberId) : await getOrgOwner(org.id);
  if (parsed.actorType === 'member' && poster?.kind === 'human') {
    const eventId = created.id;
    const messageBody = parsed.body;
    const channelId = channel.id;
    const useRealLLM = parsed.useRealLLM;

    // Attention router
    void fetch(`${originFrom(req)}/api/attention-router`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageEventId: eventId, body: messageBody, channelId, useRealLLM }),
    }).catch((err) => console.warn('[messages] attention router trigger failed:', err));

    // Memory evolution — the owner whose assistant learns from this message.
    void getOrgOwner(org.id).then((ownerUser) => {
      if (ownerUser) {
        return fetch(`${originFrom(req)}/api/memory-evolution`, {
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
