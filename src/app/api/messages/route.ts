// Vuno — POST /api/messages
// Append a MessagePosted event to a channel scope.
//
// This used to fan out to /api/attention-router and /api/memory-evolution on
// every message a person posted. Those matched substrings in the body and
// replied with hand-written text attributed to agents: one message about
// security produced five events — an observation from Sid, a counterpoint from
// Devi, two things Bob had "learned" about you, and a handoff after which Sid
// posted again, saying "Security-wise on security". It read as an organisation
// of colleagues and it was a keyword table.
//
// CLAUDE.md rules that out ("no scripted theatre standing in for a working
// mechanism"), so it is gone. Agents act through the orchestrator, which leases
// work, records what each run cost, and needs a model behind it — and says so
// when there isn't one.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
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

  // Who is posting. The composer does not send an id — there is one signed-in
  // member and the server knows who it is — and an event written without an
  // actor renders as "Unknown" and previews as "System", which is how a message
  // you just typed yourself came back unattributed.
  const poster =
    parsed.actorType === 'system'
      ? null
      : parsed.actorMemberId
        ? await getMember(parsed.actorMemberId)
        : await getOrgOwner(org.id);

  if (parsed.actorType === 'member' && !poster) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.actorMemberId
          ? 'Unknown member for this org.'
          : 'No org owner to attribute this message to. Seed the database first.',
      },
      { status: 400 },
    );
  }

  const spine = new EventSpine(org.tenantId, org.id);
  const eventInput: NewEventInput<'MessagePosted'> = {
    type: 'MessagePosted',
    actorType: parsed.actorType,
    actorMemberId: poster?.id,
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

  return NextResponse.json({ ok: true, event: created });
}
