// Vuno — /api/auth
//
// Sign in, sign out, and the first run that claims the org owner's account.
// The one route reachable without a session, which is why it does its own
// validation rather than trusting anything upstream.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { claimOwnerAccount, SESSION_COOKIE, sessionIdFromRequest, signIn, signOut } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const SESSION_DAYS = 30;

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('sign_in'),
    email: z.string().min(3).max(200),
    password: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal('claim'),
    password: z.string().min(1).max(200),
  }),
  z.object({ action: z.literal('sign_out') }),
]);

function withSession(res: NextResponse, sessionId: string, secure: boolean): NextResponse {
  res.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    // Only over TLS when there is TLS: a Secure cookie on plain http is a
    // cookie the browser silently drops, and the sign-in appears to do nothing.
    secure,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  return res;
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse((await req.json()) as unknown);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const secure = new URL(req.url).protocol === 'https:';
  const userAgent = req.headers.get('user-agent') ?? undefined;

  if (parsed.action === 'sign_out') {
    const sessionId = sessionIdFromRequest(req);
    if (sessionId) await signOut(sessionId);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }

  if (parsed.action === 'claim') {
    const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!org) {
      return NextResponse.json(
        { ok: false, error: 'No organisation exists yet. Run `bun run setup` first.' },
        { status: 409 },
      );
    }
    const result = await claimOwnerAccount(org.id, parsed.password, userAgent);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return withSession(NextResponse.json({ ok: true }), result.sessionId!, secure);
  }

  const result = await signIn(parsed.email, parsed.password, userAgent);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  return withSession(NextResponse.json({ ok: true }), result.sessionId!, secure);
}
