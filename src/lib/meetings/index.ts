// Vuno — meetings.
//
// A meeting is a conversation with a time on it. Joining one starts or joins
// the call in that conversation, so everything calls already does — the mesh,
// the record of who was in it, the honest limit about relays — applies
// unchanged. The alternative is a second real-time stack that has to be kept
// in step with the first, and drifts.
//
// Which means there is no "meeting room" separate from the channel it belongs
// to. The agenda, the messages before it, the notes after it and the call are
// all in one place, which is the thing every calendar tool fails at.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import type { MemberSummary } from '@/lib/members';

export class MeetingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'MeetingError';
  }
}

export interface MeetingRow {
  id: string;
  channelId: string;
  channelName: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  minutes: number;
  host: { id: string; displayName: string } | null;
  cancelledAt: string | null;
  /** True between its start and its end — the window where Join means now. */
  live: boolean;
  /** True once its end has passed. */
  over: boolean;
}

function decorate(m: {
  id: string;
  channelId: string;
  title: string;
  agenda: string | null;
  startsAt: Date;
  minutes: number;
  cancelledAt: Date | null;
  channel: { name: string };
  createdBy: { id: string; displayName: string } | null;
}): MeetingRow {
  const start = m.startsAt.getTime();
  const end = start + m.minutes * 60_000;
  const now = Date.now();
  return {
    id: m.id,
    channelId: m.channelId,
    channelName: m.channel.name,
    title: m.title,
    agenda: m.agenda,
    startsAt: m.startsAt.toISOString(),
    minutes: m.minutes,
    host: m.createdBy,
    cancelledAt: m.cancelledAt?.toISOString() ?? null,
    // Joinable a few minutes early, because people arrive early and a button
    // that only works on the minute is a button people learn to distrust.
    live: !m.cancelledAt && now >= start - 5 * 60_000 && now < end,
    over: now >= end,
  };
}

const INCLUDE = {
  channel: { select: { name: true } },
  createdBy: { select: { id: true, displayName: true } },
} as const;

export async function schedule(input: {
  tenantId: string;
  orgId: string;
  channelId: string;
  title: string;
  agenda?: string | null;
  startsAt: Date;
  minutes: number;
  actor: MemberSummary;
}): Promise<MeetingRow> {
  const title = input.title.trim();
  if (!title) throw new MeetingError('A meeting needs a name — it is what people see in their day.');
  if (!Number.isFinite(input.startsAt.getTime())) throw new MeetingError('That is not a time.');
  if (input.minutes < 5 || input.minutes > 480) {
    throw new MeetingError('A meeting runs between 5 minutes and 8 hours.');
  }
  // A meeting in the past cannot be attended, and scheduling one is almost
  // always a timezone mistake worth catching at the point it is made.
  if (input.startsAt.getTime() < Date.now() - 60_000) {
    throw new MeetingError('That time has passed. Check the date — it is easy to schedule into yesterday.');
  }

  const channel = await db.channel.findFirst({
    where: { id: input.channelId, orgId: input.orgId },
    select: { id: true },
  });
  if (!channel) throw new MeetingError('That conversation is not in this org.', 404);

  const created = await db.meeting.create({
    data: {
      tenantId: input.tenantId,
      orgId: input.orgId,
      channelId: input.channelId,
      title,
      agenda: input.agenda?.trim() || null,
      startsAt: input.startsAt,
      minutes: input.minutes,
      createdById: input.actor.id,
    },
    include: INCLUDE,
  });

  // Posted into the conversation, because a meeting nobody was told about is a
  // calendar entry. The message is the invitation.
  await new EventSpine(input.tenantId, input.orgId).append([
    {
      type: 'MessagePosted',
      actorType: 'member',
      actorMemberId: input.actor.id,
      scopeType: 'channel',
      scopeId: input.channelId,
      payload: {
        body:
          `📅 **${title}** — ${input.startsAt.toUTCString()} · ${input.minutes} min\n\n` +
          (input.agenda?.trim() ? `${input.agenda.trim()}\n\n` : '') +
          'Join from the Call button here when it starts.',
      },
    },
  ]);

  return decorate(created);
}

export async function cancel(orgId: string, meetingId: string, actor: MemberSummary): Promise<MeetingRow> {
  const meeting = await db.meeting.findFirst({ where: { id: meetingId, orgId }, include: INCLUDE });
  if (!meeting) throw new MeetingError('That meeting is not in this org.', 404);
  if (meeting.cancelledAt) return decorate(meeting);

  // Whoever booked it, or anyone if the host has since been retired — a
  // meeting nobody can cancel is worse than one anybody can.
  if (meeting.createdById && meeting.createdById !== actor.id) {
    const host = await db.member.findFirst({
      where: { id: meeting.createdById, status: 'active' },
      select: { id: true },
    });
    if (host) throw new MeetingError('Only whoever scheduled a meeting can call it off.', 403);
  }

  const updated = await db.meeting.update({
    where: { id: meeting.id },
    data: { cancelledAt: new Date() },
    include: INCLUDE,
  });

  await new EventSpine(meeting.tenantId, orgId).append([
    {
      type: 'MessagePosted',
      actorType: 'member',
      actorMemberId: actor.id,
      scopeType: 'channel',
      scopeId: meeting.channelId,
      payload: { body: `📅 ~~${meeting.title}~~ was called off.` },
    },
  ]);

  return decorate(updated);
}

/**
 * What is coming up, across the conversations this viewer can read.
 *
 * Filtered by readability rather than by invitation: a meeting in a channel is
 * open to that channel, the same way its messages are. There is no separate
 * invite list to fall out of step with who can actually get in.
 */
export async function upcoming(
  orgId: string,
  readableChannelIds: string[],
  limit = 8,
): Promise<MeetingRow[]> {
  if (readableChannelIds.length === 0) return [];
  const rows = await db.meeting.findMany({
    where: {
      orgId,
      channelId: { in: readableChannelIds },
      cancelledAt: null,
      // Still showing while it is running: the point of the list is to get you
      // into the one that started three minutes ago.
      startsAt: { gte: new Date(Date.now() - 4 * 3_600_000) },
    },
    orderBy: { startsAt: 'asc' },
    take: limit,
    include: INCLUDE,
  });
  return rows.map(decorate).filter((m) => !m.over);
}

/** The meetings booked in one conversation, soonest first. */
export async function meetingsIn(orgId: string, channelId: string): Promise<MeetingRow[]> {
  const rows = await db.meeting.findMany({
    where: { orgId, channelId, cancelledAt: null, startsAt: { gte: new Date(Date.now() - 4 * 3_600_000) } },
    orderBy: { startsAt: 'asc' },
    take: 10,
    include: INCLUDE,
  });
  return rows.map(decorate).filter((m) => !m.over);
}
