// Vuno — /api/calls/signal
//
// The introduction. Two browsers that want to talk to each other have to
// exchange an offer, an answer, and a handful of network candidates first;
// WebRTC deliberately does not say how, because it depends on what you already
// have. This app already has a signed-in viewer and an HTTP request, so that is
// what it uses.
//
// GET is a poll rather than an SSE stream, and that is the smaller mechanism
// for once. The whole exchange is a few seconds at the start of a call and then
// nothing, so a stream held open for the duration would be a connection per
// participant doing nothing for an hour. A poll every second for the first few
// seconds costs less and has no reconnect logic.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { CallError, heartbeat, sendSignal, takeSignals } from '@/lib/calls';

export const dynamic = 'force-dynamic';

/** The member is in the call, and the call is in a conversation they can read. */
async function seatOf(req: Request, callId: string) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) throw new CallError('Sign in first.', 401);

  const seat = await db.callParticipant.findFirst({
    where: { callId, memberId: viewer.id },
    select: { id: true, call: { select: { id: true, endedAt: true } } },
  });
  // Checked here rather than trusting the id: a call id is the only thing
  // standing between a signal and somebody else's conversation.
  if (!seat) throw new CallError('You are not in that call.', 403);
  if (seat.call.endedAt) throw new CallError('That call has ended.', 409);
  return viewer;
}

function fail(e: unknown) {
  if (e instanceof CallError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: e.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
  }
  throw e;
}

/** Say you are still here, collect what is addressed to you, learn who else is. */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const callId = params.get('callId');
    if (!callId) return NextResponse.json({ ok: false, error: 'No call named.' }, { status: 400 });

    const viewer = await seatOf(req, callId);
    const after = Number(params.get('after') ?? 0);

    const present = heartbeat(callId, viewer.id);
    const signals = takeSignals(callId, viewer.id, Number.isFinite(after) ? after : 0);

    return NextResponse.json({ ok: true, present, signals });
  } catch (e) {
    return fail(e);
  }
}

const body = z.object({
  callId: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(['offer', 'answer', 'candidate', 'bye']),
  // Opaque: SDP and ICE candidates are for the browsers, not for this server to
  // understand. Bounded because it is still a body somebody can post.
  payload: z.unknown(),
});

export async function POST(req: Request) {
  try {
    const parsed = body.parse((await req.json()) as unknown);
    const viewer = await seatOf(req, parsed.callId);

    const size = JSON.stringify(parsed.payload ?? null).length;
    if (size > 64_000) {
      return NextResponse.json({ ok: false, error: 'That signal is too large.' }, { status: 413 });
    }

    // The recipient has to be in the call too — otherwise this is a way to push
    // an arbitrary payload at any member id somebody can guess.
    const peer = await db.callParticipant.findFirst({
      where: { callId: parsed.callId, memberId: parsed.to },
      select: { id: true },
    });
    if (!peer) return NextResponse.json({ ok: false, error: 'That member is not in this call.' }, { status: 404 });

    sendSignal({
      callId: parsed.callId,
      from: viewer.id,
      to: parsed.to,
      kind: parsed.kind,
      payload: parsed.payload,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
