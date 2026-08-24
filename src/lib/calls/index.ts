// Vuno — calls.
//
// A real WebRTC call: the browsers connect to each other and the media never
// touches this server. What the server does is introduce them, which is the
// part WebRTC deliberately leaves to the application.
//
// **Signalling is in memory, per process, and that is a decision.** An offer is
// meaningful for the few seconds between one browser making it and another
// answering; writing it to the spine would put a hundred rows of SDP into the
// org's permanent record for every call, and the spine is what the org
// believes, not its plumbing. What *does* go on the spine is that a call
// happened, who was in it and how long it lasted — the part somebody will ask
// about later.
//
// **What is honest about the limits.** Peer-to-peer works directly when both
// sides can see each other, and needs a STUN server to discover their public
// addresses. Behind a symmetric NAT — a corporate network, some mobile
// carriers — neither side can reach the other and the call needs a relay
// (TURN), which is a server somebody has to run and pay for. There is no TURN
// here unless one is configured, so `iceServers()` says exactly which case
// this install is in rather than shipping a call button that fails silently
// for a third of people.

import { db } from '@/lib/db';
import { MAX_PARTICIPANTS } from '@/lib/calls/shape';
import { EventSpine } from '@/lib/events/spine';
import type { MemberSummary } from '@/lib/members';

export class CallError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'CallError';
  }
}

// The seat cap and the ring/room rule live in `./shape`, which imports nothing,
// so a client component can ask for them without pulling Prisma into the
// browser bundle — which is exactly what happened the first time.
export { MAX_PARTICIPANTS, styleFor, type CallStyle } from '@/lib/calls/shape';

/** A signal nobody collected within this is gone. Offers do not age well. */
const SIGNAL_TTL_MS = 60_000;

/** A participant that has not been seen for this long has dropped. */
export const HEARTBEAT_TIMEOUT_MS = 20_000;

export interface IceConfig {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  /** Null when a relay is configured; otherwise what will not work, and why. */
  limitation: string | null;
}

/**
 * What the browser needs to find a path to its peer.
 *
 * STUN is free and public and gets most calls connected. TURN relays the media
 * when nothing else can, costs bandwidth, and has to be run by somebody — so it
 * is configuration, and its absence is stated rather than discovered.
 */
export function iceConfig(): IceConfig {
  const stun = process.env.VUNO_STUN_URL?.trim() || 'stun:stun.l.google.com:19302';
  const turnUrl = process.env.VUNO_TURN_URL?.trim();
  const turnUser = process.env.VUNO_TURN_USERNAME?.trim();
  const turnPass = process.env.VUNO_TURN_PASSWORD?.trim();

  const iceServers: IceConfig['iceServers'] = [{ urls: stun }];
  if (turnUrl && turnUser && turnPass) {
    iceServers.push({ urls: turnUrl, username: turnUser, credential: turnPass });
    return { iceServers, limitation: null };
  }

  return {
    iceServers,
    limitation:
      'No relay is configured, so a call will not connect between two networks that cannot reach each other ' +
      'directly — a corporate firewall or a symmetric NAT on either side. Set VUNO_TURN_URL, ' +
      'VUNO_TURN_USERNAME and VUNO_TURN_PASSWORD to fix that.',
  };
}

// ─── Signalling ──────────────────────────────────────────────────────────────

export type SignalKind = 'offer' | 'answer' | 'candidate' | 'bye';

export interface Signal {
  id: number;
  callId: string;
  from: string;
  to: string;
  kind: SignalKind;
  /** SDP or an ICE candidate, opaque here. The browsers understand it. */
  payload: unknown;
  at: number;
}

interface Room {
  /** memberId → last heartbeat. */
  present: Map<string, number>;
  /** Undelivered signals, oldest first. */
  queue: Signal[];
  nextId: number;
}

const rooms = new Map<string, Room>();

function room(callId: string): Room {
  const existing = rooms.get(callId);
  if (existing) return existing;
  const created: Room = { present: new Map(), queue: [], nextId: 1 };
  rooms.set(callId, created);
  return created;
}

/** Drop what has expired, and anyone who stopped saying they were here. */
function sweep(r: Room, now = Date.now()): void {
  r.queue = r.queue.filter((s) => now - s.at < SIGNAL_TTL_MS);
  for (const [memberId, seen] of r.present) {
    if (now - seen > HEARTBEAT_TIMEOUT_MS) r.present.delete(memberId);
  }
}

/** Say you are here, and find out who else is. */
export function heartbeat(callId: string, memberId: string): string[] {
  const r = room(callId);
  const now = Date.now();
  r.present.set(memberId, now);
  sweep(r, now);
  return [...r.present.keys()];
}

export function leaveRoom(callId: string, memberId: string): void {
  const r = rooms.get(callId);
  if (!r) return;
  r.present.delete(memberId);
  // Nothing left to signal about, and nothing to keep the map growing for.
  if (r.present.size === 0) rooms.delete(callId);
}

export function sendSignal(input: {
  callId: string;
  from: string;
  to: string;
  kind: SignalKind;
  payload: unknown;
}): void {
  const r = room(input.callId);
  sweep(r);
  r.queue.push({ id: r.nextId++, ...input, at: Date.now() });
}

/** Everything addressed to this member after `afterId`. */
export function takeSignals(callId: string, memberId: string, afterId: number): Signal[] {
  const r = rooms.get(callId);
  if (!r) return [];
  sweep(r);
  return r.queue.filter((s) => s.to === memberId && s.id > afterId);
}

/** Only for tests: forget every room. */
export function resetRooms(): void {
  rooms.clear();
}

// ─── The record ──────────────────────────────────────────────────────────────

export interface CallRow {
  id: string;
  channelId: string;
  startedAt: string;
  endedAt: string | null;
  startedBy: { id: string; displayName: string } | null;
  participants: Array<{ id: string; displayName: string; kind: string }>;
}

/**
 * Start a call in a conversation, or join the one already running.
 *
 * Joining rather than starting a second is the whole point: two people who
 * both press Call within a second of each other should end up in one call, not
 * two rooms of one person each wondering where the other went.
 */
export async function startOrJoin(input: {
  tenantId: string;
  orgId: string;
  channelId: string;
  actor: MemberSummary;
}): Promise<{ call: CallRow; joined: boolean }> {
  const live = await db.call.findFirst({
    where: { orgId: input.orgId, channelId: input.channelId, endedAt: null },
    orderBy: { startedAt: 'desc' },
    include: { participants: { include: { member: { select: { id: true, displayName: true, kind: true } } } } },
  });

  if (live) {
    const already = live.participants.some((p) => p.memberId === input.actor.id);
    if (!already) {
      if (live.participants.filter((p) => p.leftAt === null).length >= MAX_PARTICIPANTS) {
        throw new CallError(`This call is full — ${MAX_PARTICIPANTS} is the limit.`, 409);
      }
      await db.callParticipant.create({
        data: {
          tenantId: input.tenantId,
          orgId: input.orgId,
          callId: live.id,
          memberId: input.actor.id,
        },
      });
    } else {
      // Rejoining after a drop: the same seat, not a second one.
      await db.callParticipant.updateMany({
        where: { callId: live.id, memberId: input.actor.id },
        data: { leftAt: null },
      });
    }
    return { call: await readCall(live.id), joined: true };
  }

  const created = await db.call.create({
    data: {
      tenantId: input.tenantId,
      orgId: input.orgId,
      channelId: input.channelId,
      startedById: input.actor.id,
      participants: {
        create: [{ tenantId: input.tenantId, orgId: input.orgId, memberId: input.actor.id }],
      },
    },
  });

  // The spine records that a call happened — not a byte of what was said in it.
  await new EventSpine(input.tenantId, input.orgId).append([
    {
      type: 'CallStarted',
      actorType: 'member',
      actorMemberId: input.actor.id,
      scopeType: 'channel',
      scopeId: input.channelId,
      payload: { callId: created.id },
    },
  ]);

  return { call: await readCall(created.id), joined: false };
}

/**
 * Calls ringing for this viewer, anywhere in the app.
 *
 * A DM call has to reach somebody who is reading something else — that is the
 * difference between a call and a notice, and a call button that only works
 * when the other person happens to have the conversation open is a notice.
 *
 * Deliberately *not* channel calls. A channel is a room somebody opened, and it
 * announces itself in the channel; interrupting everyone in the org because a
 * working group started talking is the behaviour this split exists to prevent.
 */
export async function ringingFor(
  orgId: string,
  viewer: { id: string; ownerMemberId?: string | null },
): Promise<Array<{ callId: string; channelId: string; conversationName: string; from: string; since: string }>> {
  const live = await db.call.findMany({
    where: {
      orgId,
      endedAt: null,
      // Ringing kinds only, in a conversation this viewer is part of.
      // `styleFor` states the rule; this is the query form of the same sentence.
      channel: { kind: { in: ['dm', 'group'] }, members: { some: { memberId: viewer.id } } },
      // And not a call they are already in.
      participants: { none: { memberId: viewer.id, leftAt: null } },
    },
    orderBy: { startedAt: 'desc' },
    take: 5,
    include: {
      channel: { select: { id: true, name: true } },
      startedBy: { select: { displayName: true } },
      participants: {
        where: { leftAt: null },
        include: { member: { select: { id: true, displayName: true } } },
      },
    },
  });

  return live
    // A call every participant has left is over even if nothing closed it —
    // a browser that crashed does not get to ring somebody forever.
    .filter((c) => c.participants.length > 0)
    .map((c) => ({
      callId: c.id,
      channelId: c.channelId,
      // A DM is named for whoever is not reading it, and the row's stored name
      // is not that. The caller is who you actually want to see.
      conversationName: c.channel.name,
      from: c.startedBy?.displayName ?? c.participants[0]?.member.displayName ?? 'Someone',
      since: c.startedAt.toISOString(),
    }));
}

export async function leaveCall(input: {
  orgId: string;
  callId: string;
  actor: MemberSummary;
}): Promise<{ ended: boolean }> {
  const call = await db.call.findFirst({
    where: { id: input.callId, orgId: input.orgId },
    include: { participants: true },
  });
  if (!call) throw new CallError('That call is not in this org.', 404);

  await db.callParticipant.updateMany({
    where: { callId: call.id, memberId: input.actor.id, leftAt: null },
    data: { leftAt: new Date() },
  });
  leaveRoom(call.id, input.actor.id);

  const remaining = await db.callParticipant.count({ where: { callId: call.id, leftAt: null } });
  if (remaining > 0 || call.endedAt) return { ended: false };

  const endedAt = new Date();
  await db.call.update({ where: { id: call.id }, data: { endedAt } });

  const seconds = Math.max(1, Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000));
  await new EventSpine(call.tenantId, input.orgId).append([
    {
      type: 'CallEnded',
      actorType: 'member',
      actorMemberId: input.actor.id,
      scopeType: 'channel',
      scopeId: call.channelId,
      payload: {
        callId: call.id,
        seconds,
        participantIds: [...new Set(call.participants.map((p) => p.memberId))],
      },
    },
  ]);
  return { ended: true };
}

export async function readCall(callId: string): Promise<CallRow> {
  const call = await db.call.findUniqueOrThrow({
    where: { id: callId },
    include: {
      startedBy: { select: { id: true, displayName: true } },
      participants: {
        where: { leftAt: null },
        include: { member: { select: { id: true, displayName: true, kind: true } } },
      },
    },
  });
  return {
    id: call.id,
    channelId: call.channelId,
    startedAt: call.startedAt.toISOString(),
    endedAt: call.endedAt?.toISOString() ?? null,
    startedBy: call.startedBy,
    participants: call.participants.map((p) => p.member),
  };
}

/** The call running in a conversation right now, if there is one. */
export async function liveCall(orgId: string, channelId: string): Promise<CallRow | null> {
  const call = await db.call.findFirst({
    where: { orgId, channelId, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  return call ? readCall(call.id) : null;
}
