// Vuno — /api/calls
//
// Start or join the call in a conversation, and leave it. Signalling is a
// different route because it is a different shape: this is two requests a call,
// that is a stream.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { canRead, getConversation } from '@/lib/conversations';
import { CallError, iceConfig, leaveCall, liveCall, startOrJoin } from '@/lib/calls';

export const dynamic = 'force-dynamic';

async function context(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) throw new CallError('Sign in first.', 401);
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
  if (!org) throw new CallError('No organisation found.', 409);
  return { viewer, org };
}

function fail(e: unknown) {
  if (e instanceof CallError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: e.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
  }
  throw e;
}

/** What is running in a conversation, and what the browser needs to connect. */
export async function GET(req: Request) {
  try {
    const { viewer, org } = await context(req);
    const channelId = new URL(req.url).searchParams.get('channelId');
    if (!channelId) return NextResponse.json({ ok: false, error: 'No conversation named.' }, { status: 400 });

    const conversation = await getConversation(org.id, channelId, 'system');
    if (!conversation || !canRead(conversation, viewer)) {
      return NextResponse.json({ ok: false, error: 'That conversation is not open to you.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, call: await liveCall(org.id, channelId), ice: iceConfig() });
  } catch (e) {
    return fail(e);
  }
}

const startBody = z.object({ channelId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { viewer, org } = await context(req);
    const { channelId } = startBody.parse((await req.json()) as unknown);

    // A call in a conversation is part of that conversation, so the same rule
    // decides it: being signed in is not being in the room.
    const conversation = await getConversation(org.id, channelId, 'system');
    if (!conversation || !canRead(conversation, viewer)) {
      return NextResponse.json({ ok: false, error: 'That conversation is not open to you.' }, { status: 404 });
    }

    const { call, joined } = await startOrJoin({
      tenantId: org.tenantId,
      orgId: org.id,
      channelId,
      actor: viewer,
    });
    return NextResponse.json({ ok: true, call, joined, ice: iceConfig() });
  } catch (e) {
    return fail(e);
  }
}

const leaveBody = z.object({ callId: z.string().min(1) });

export async function DELETE(req: Request) {
  try {
    const { viewer, org } = await context(req);
    const { callId } = leaveBody.parse((await req.json()) as unknown);
    const { ended } = await leaveCall({ orgId: org.id, callId, actor: viewer });
    return NextResponse.json({ ok: true, ended });
  } catch (e) {
    return fail(e);
  }
}
