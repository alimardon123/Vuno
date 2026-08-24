// Vuno — POST /api/messages/actions
//
// One route for the five things you can do to a message that already exists.
// They share every check — is there a session, is this conversation open to
// you, is that message in it — and splitting them into five routes would mean
// five copies of the checks and four chances for one of them to drift.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { canRead, getConversation } from '@/lib/conversations';
import { takeWrite } from '@/lib/limits';
import { editMessage, MessageActionError, pinMessage, react, redactMessage } from '@/lib/messages/actions';

export const dynamic = 'force-dynamic';

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('react'),
    channelId: z.string().min(1),
    targetEventId: z.string().min(1),
    emoji: z.string().min(1).max(16),
    on: z.boolean(),
  }),
  z.object({
    action: z.literal('edit'),
    channelId: z.string().min(1),
    targetEventId: z.string().min(1),
    body: z.string().min(1).max(4_000),
  }),
  z.object({
    action: z.literal('delete'),
    channelId: z.string().min(1),
    targetEventId: z.string().min(1),
  }),
  z.object({
    action: z.literal('pin'),
    channelId: z.string().min(1),
    targetEventId: z.string().min(1),
    on: z.boolean(),
  }),
]);

export async function POST(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse((await req.json()) as unknown);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body' },
      { status: 400 },
    );
  }

  // Reactions are the fastest thing to click in the app and the easiest to
  // loop, so they count against the same budget as a message.
  const rate = takeWrite(`action:${viewer.id}`);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: `Slow down for ${rate.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  const conversation = await getConversation(org.id, parsed.channelId, 'system');
  if (!conversation || !canRead(conversation, viewer)) {
    return NextResponse.json({ ok: false, error: 'That conversation is not open to you.' }, { status: 404 });
  }

  const ctx = { tenantId: org.tenantId, orgId: org.id, channelId: parsed.channelId, actor: viewer };

  try {
    switch (parsed.action) {
      case 'react':
        await react(ctx, parsed.targetEventId, parsed.emoji, parsed.on);
        break;
      case 'edit':
        await editMessage(ctx, parsed.targetEventId, parsed.body);
        break;
      case 'delete':
        await redactMessage(ctx, parsed.targetEventId);
        break;
      case 'pin':
        await pinMessage(ctx, parsed.targetEventId, parsed.on);
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MessageActionError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
