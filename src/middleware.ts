// Vuno — nothing is reachable without a session.
//
// Enforced here rather than route by route: a check that has to be remembered
// in thirty places is a check that will be forgotten in one, and the one will be
// the route that matters.
//
// The middleware only looks for the cookie. Whether the session is real is
// decided by `memberForSession` on the server, because Prisma cannot run in the
// edge runtime — so this stops the anonymous case and the pages verify the rest.

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'vuno_session';

/** Reachable signed out. Everything else is not. */
const PUBLIC = ['/sign-in', '/api/auth'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }

  // An API call gets a status it can act on; a page gets sent somewhere useful,
  // carrying where it was going so signing in lands there.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
