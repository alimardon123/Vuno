// Sign a test in, the way a browser does.
//
// The routes read the session off the request's cookie header, so a test hands
// them one — which means the auth path is exercised rather than bypassed. A
// helper that reached past it would leave the one check that matters untested.

import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth';

export interface TestSession {
  id: string;
  header: { Cookie: string };
}

let counter = 0;

/** A live session for this member, and the Cookie header that carries it. */
export async function signedInAs(memberId: string): Promise<TestSession> {
  const id = `test-session-${++counter}-${memberId}`;
  await db.session.upsert({
    where: { id },
    create: { id, memberId, expiresAt: new Date(Date.now() + 3_600_000) },
    update: { expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id, header: { Cookie: `${SESSION_COOKIE}=${id}` } };
}

export async function clearSessions(): Promise<void> {
  await db.session.deleteMany({ where: { id: { startsWith: 'test-session-' } } });
}
