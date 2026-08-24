// Vuno — /api/meetings
//
// Schedule a meeting in a conversation, or call one off. Both are actions the
// conversation's members can see, so both go through the same access check the
// conversation itself uses.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { canRead, getConversation, listConversations } from '@/lib/conversations';
import { takeWrite } from '@/lib/limits';
import { cancel, MeetingError, schedule, upcoming } from '@/lib/meetings';

export const dynamic = 'force-dynamic';

function fail(e: unknown) {
  if (e instanceof MeetingError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    return NextResponse.json({ ok: false, error: e.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
  }
  throw e;
}

async function context(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) throw new MeetingError('Sign in first.', 401);
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
  if (!org) throw new MeetingError('No organisation found.', 409);
  return { viewer, org };
}

/** What is coming up, in the conversations this viewer can read. */
export async function GET(req: Request) {
  try {
    const { viewer, org } = await context(req);
    const readable = await listConversations(org.id, viewer.id);
    return NextResponse.json({
      ok: true,
      meetings: await upcoming(org.id, readable.map((c) => c.id)),
    });
  } catch (e) {
    return fail(e);
  }
}

const scheduleBody = z.object({
  channelId: z.string().min(1),
  title: z.string().min(1).max(160),
  agenda: z.string().max(2_000).nullish(),
  /** ISO, from the browser, which knows the reader's timezone and this does not. */
  startsAt: z.string().min(1),
  minutes: z.number().int().min(5).max(480),
});

export async function POST(req: Request) {
  try {
    const { viewer, org } = await context(req);

    const rate = takeWrite(`meeting:${viewer.id}`);
    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: `Slow down for ${rate.retryAfterSeconds}s.` },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
      );
    }

    const parsed = scheduleBody.parse((await req.json()) as unknown);
    const conversation = await getConversation(org.id, parsed.channelId, 'system');
    if (!conversation || !canRead(conversation, viewer)) {
      return NextResponse.json({ ok: false, error: 'That conversation is not open to you.' }, { status: 404 });
    }

    const meeting = await schedule({
      tenantId: org.tenantId,
      orgId: org.id,
      channelId: parsed.channelId,
      title: parsed.title,
      agenda: parsed.agenda ?? null,
      startsAt: new Date(parsed.startsAt),
      minutes: parsed.minutes,
      actor: viewer,
    });
    return NextResponse.json({ ok: true, meeting });
  } catch (e) {
    return fail(e);
  }
}

const cancelBody = z.object({ meetingId: z.string().min(1) });

export async function DELETE(req: Request) {
  try {
    const { viewer, org } = await context(req);
    const { meetingId } = cancelBody.parse((await req.json()) as unknown);
    return NextResponse.json({ ok: true, meeting: await cancel(org.id, meetingId, viewer) });
  } catch (e) {
    return fail(e);
  }
}
