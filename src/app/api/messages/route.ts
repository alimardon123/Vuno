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
import { getMember } from '@/lib/members';
import { viewerFromRequest } from '@/lib/auth';
import { EventSpine } from '@/lib/events/spine';
import { extractHandles } from '@/lib/mentions';
import { enqueue } from '@/lib/orchestrator/queue';
import { takeWrite } from '@/lib/limits';
import { canRead, getConversation } from '@/lib/conversations';
import { AttachmentError, linkToEvent, MAX_PER_MESSAGE } from '@/lib/attachments';
import type { NewEventInput } from '@/lib/events/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  // Empty is allowed when files are attached — "here is the screenshot" with no
  // sentence is a message people actually send.
  body: z.string().max(4000).default(''),
  channelId: z.string().min(1),
  attachmentIds: z.array(z.string().min(1)).max(MAX_PER_MESSAGE).default([]),
  /** The message this answers. Makes it a ThreadReplyPosted rather than a post. */
  replyToEventId: z.string().min(1).optional(),
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

  if (parsed.body.trim().length === 0 && parsed.attachmentIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nothing to send.' }, { status: 400 });
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
        : await viewerFromRequest(req);

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

  // Counted against the member, not the connection: limiting by IP punishes an
  // office behind one router and does nothing to a script running locally,
  // which is the case this actually guards.
  const rate = takeWrite(`message:${poster?.id ?? parsed.actorType}`);
  if (!rate.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `That is a lot of messages very quickly. Try again in ${rate.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  // Being signed in is not the same as being in this conversation. Without
  // this, any member could post into anyone's DM by knowing its id.
  const conversation = await getConversation(org.id, channel.id, poster?.id);
  if (!conversation || !canRead(conversation, poster)) {
    // The same answer as a channel that does not exist: confirming that a
    // conversation is there but closed to you is still telling you it is there.
    return NextResponse.json({ ok: false, error: 'Unknown channel for this org.' }, { status: 400 });
  }

  // A reply to a message that is not in this conversation would render as a
  // quotation of something the reader cannot see.
  if (parsed.replyToEventId) {
    const parent = await db.event.findFirst({
      where: { id: parsed.replyToEventId, orgId: org.id, scopeType: 'channel', scopeId: channel.id },
      select: { id: true },
    });
    if (!parent) {
      return NextResponse.json({ ok: false, error: 'That message is not in this conversation.' }, { status: 400 });
    }
  }

  const spine = new EventSpine(org.tenantId, org.id);
  const eventInput: NewEventInput = parsed.replyToEventId
    ? {
        type: 'ThreadReplyPosted',
        actorType: parsed.actorType,
        actorMemberId: poster?.id,
        onBehalfOfMemberId: parsed.onBehalfOfMemberId,
        scopeType: 'channel',
        scopeId: channel.id,
        payload: { body: parsed.body, parentId: parsed.replyToEventId },
      }
    : {
        type: 'MessagePosted',
        actorType: parsed.actorType,
        actorMemberId: poster?.id,
        onBehalfOfMemberId: parsed.onBehalfOfMemberId,
        scopeType: 'channel',
        scopeId: channel.id,
        payload: { body: parsed.body },
      };
  const [created] = await spine.append([eventInput]);

  // Linked after the event exists, because the event is what they belong to.
  // If this fails the message still stands — a message that posted and lost its
  // screenshot is recoverable; one that vanished because a file was already
  // claimed is not, and the reader saw it go.
  if (parsed.attachmentIds.length > 0) {
    try {
      await linkToEvent({
        orgId: org.id,
        channelId: channel.id,
        uploaderId: poster?.id ?? '',
        eventId: created.id,
        attachmentIds: parsed.attachmentIds,
      });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: e instanceof AttachmentError ? e.message : 'Those files could not be attached.',
          event: created,
        },
        { status: e instanceof AttachmentError ? e.status : 500 },
      );
    }
  }


  // `@bob` brings Bob in. A lookup against handles that exist, not a guess at
  // what the message is about — and the conversation is unchanged by it: a DM
  // summoning an assistant is still a DM, with the same members and the same
  // place in the sidebar (docs/IA-NAVIGATION.md).
  //
  // The turn runs in the orchestrator, not here: it leases the work, records
  // what the run cost, retries what is worth retrying, and survives this
  // request ending.
  // Capped: `@a @b @c …` in one message is one turn per agent, each a model
  // call somebody pays for. Three is enough to bring a working group in and
  // low enough that a pasted list cannot empty a budget.
  const MAX_SUMMONED = 3;
  const handles = extractHandles(parsed.body).slice(0, MAX_SUMMONED);
  const mentioned = handles.length
    ? await db.member.findMany({
        where: { orgId: org.id, kind: 'agent', status: 'active', handle: { in: handles } },
        select: { id: true, handle: true, agent: { select: { ownerMemberId: true } } },
      })
    : [];

  for (const agent of mentioned) {
    if (agent.id === poster?.id) continue; // an agent mentioning itself is not a summons
    await enqueue({
      tenantId: org.tenantId,
      orgId: org.id,
      kind: 'agent_turn',
      subjectType: 'channel',
      subjectId: channel.id,
      assigneeId: agent.id,
      // One turn per message per agent: a retry of this request must not queue
      // a second answer to the same question.
      dedupeKey: `mention:${created.id}:${agent.id}`,
      input: {
        memberId: agent.id,
        scopeType: 'channel',
        scopeId: channel.id,
        reason: `${poster?.displayName ?? 'Someone'} mentioned you: "${parsed.body.slice(0, 400)}"`,
        // Only your own assistant carries your authority. Calling on Sid gets
        // you Sid's opinion, not something said in your name — the delegation
        // is the ownership, not the mention (ADR-0009 §1).
        ...(poster && agent.agent?.ownerMemberId === poster.id
          ? { onBehalfOfMemberId: poster.id }
          : {}),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    event: created,
    ...(mentioned.length ? { summoned: mentioned.map((m) => m.handle) } : {}),
  });
}
