// There was no authentication at all: whoever reached the port was the org
// owner and could post as them, hire, retire and read every DM.
//
// The tests that matter here are the refusals — a sign-in that says which half
// you got wrong is an account list waiting to be enumerated, and a session you
// cannot revoke is a password with an expiry date.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import {
  claimOwnerAccount,
  memberForSession,
  needsFirstRun,
  pruneSessions,
  sessionIdFromRequest,
  SESSION_COOKIE,
  setPassword,
  signIn,
  signOut,
  signOutEverywhere,
  viewerFromRequest,
} from '@/lib/auth';

const TENANT = 'tnt-auth';
const ORG = 'org-auth';
const OWNER = 'mbr-auth-owner';
const STAFF = 'mbr-auth-staff';
const GONE = 'mbr-auth-gone';

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'auth-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'auth-o' } });
  await db.member.create({
    data: {
      id: OWNER, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Kai', handle: 'auth-kai',
      human: { create: { email: 'kai@auth.test', isOrgOwner: true } },
    },
  });
  await db.member.create({
    data: {
      id: STAFF, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Mira', handle: 'auth-mira',
      human: { create: { email: 'mira@auth.test' } },
    },
  });
  await db.member.create({
    data: {
      id: GONE, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Gone', handle: 'auth-gone',
      status: 'retired',
      human: { create: { email: 'gone@auth.test' } },
    },
  });
});

afterEach(async () => {
  await db.session.deleteMany({ where: { member: { orgId: ORG } } });
  await db.humanProfile.updateMany({
    where: { member: { orgId: ORG } },
    data: { passwordHash: null },
  });
});

afterAll(async () => {
  await db.session.deleteMany({ where: { member: { orgId: ORG } } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

const req = (cookie?: string) =>
  new Request('http://localhost/api/x', cookie ? { headers: { cookie } } : undefined);

describe('the first run claims the owner account', () => {
  test('a seeded org has nobody who can sign in', async () => {
    expect(await needsFirstRun(ORG)).toBe(true);
  });

  test('claiming sets the password and signs you in', async () => {
    const result = await claimOwnerAccount(ORG, 'a-real-password');
    expect(result.ok).toBe(true);

    const viewer = await memberForSession(result.sessionId);
    expect(viewer?.id).toBe(OWNER);
    expect(await needsFirstRun(ORG)).toBe(false);
  });

  test('it cannot be used twice — an org is not taken over later', async () => {
    await claimOwnerAccount(ORG, 'a-real-password');
    const second = await claimOwnerAccount(ORG, 'someone-elses-password');

    expect(second.ok).toBe(false);
    expect(second.error).toContain('Sign in instead');
  });

  test('a short password is refused, and says why it matters', async () => {
    const result = await claimOwnerAccount(ORG, 'short');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('8 characters');
    expect(await needsFirstRun(ORG)).toBe(true);
  });
});

describe('signing in', () => {
  test('the right password works and produces a session', async () => {
    await setPassword(OWNER, 'correct-horse-battery');
    const result = await signIn('kai@auth.test', 'correct-horse-battery');

    expect(result.ok).toBe(true);
    expect((await memberForSession(result.sessionId))?.id).toBe(OWNER);
  });

  test('the wrong password is refused', async () => {
    await setPassword(OWNER, 'correct-horse-battery');
    expect((await signIn('kai@auth.test', 'wrong')).ok).toBe(false);
  });

  test('an unknown email and a wrong password fail identically', async () => {
    await setPassword(OWNER, 'correct-horse-battery');
    const unknown = await signIn('nobody@auth.test', 'anything');
    const wrong = await signIn('kai@auth.test', 'wrong');

    // Telling someone which half they got right is how an account list gets
    // enumerated.
    expect(unknown.error).toBe(wrong.error);
    expect(unknown.ok).toBe(false);
  });

  test('an account with no password set cannot be signed into', async () => {
    expect((await signIn('mira@auth.test', 'anything')).ok).toBe(false);
  });

  test('a retired member is refused, and told to ask', async () => {
    await setPassword(GONE, 'still-knows-it');
    const result = await signIn('gone@auth.test', 'still-knows-it');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('retired');
  });

  test('email is matched case-insensitively', async () => {
    await setPassword(OWNER, 'correct-horse-battery');
    expect((await signIn('  KAI@Auth.Test ', 'correct-horse-battery')).ok).toBe(true);
  });
});

describe('sessions can actually be ended', () => {
  test('signing out invalidates that session immediately', async () => {
    await setPassword(OWNER, 'correct-horse-battery');
    const { sessionId } = await signIn('kai@auth.test', 'correct-horse-battery');

    expect(await memberForSession(sessionId)).not.toBeNull();
    await signOut(sessionId!);
    expect(await memberForSession(sessionId)).toBeNull();
  });

  test('signing out everywhere ends every session for that member', async () => {
    await setPassword(OWNER, 'correct-horse-battery');
    const a = await signIn('kai@auth.test', 'correct-horse-battery');
    const b = await signIn('kai@auth.test', 'correct-horse-battery');

    expect(await signOutEverywhere(OWNER)).toBe(2);
    expect(await memberForSession(a.sessionId)).toBeNull();
    expect(await memberForSession(b.sessionId)).toBeNull();
  });

  test('an expired session is refused and cleaned up', async () => {
    await db.session.create({
      data: { id: 'expired-one', memberId: OWNER, expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await memberForSession('expired-one')).toBeNull();
    expect(await db.session.count({ where: { id: 'expired-one' } })).toBe(0);
  });

  test('pruning removes expired rows and leaves live ones', async () => {
    await db.session.create({
      data: { id: 'old-one', memberId: OWNER, expiresAt: new Date(Date.now() - 1000) },
    });
    await db.session.create({
      data: { id: 'live-one', memberId: OWNER, expiresAt: new Date(Date.now() + 60_000) },
    });

    await pruneSessions();
    expect(await db.session.count({ where: { id: 'old-one' } })).toBe(0);
    expect(await db.session.count({ where: { id: 'live-one' } })).toBe(1);
  });

  test('a session whose member was retired stops working', async () => {
    await db.session.create({
      data: { id: 'still-open', memberId: STAFF, expiresAt: new Date(Date.now() + 60_000) },
    });
    expect(await memberForSession('still-open')).not.toBeNull();

    await db.member.update({ where: { id: STAFF }, data: { status: 'retired' } });
    try {
      // Retiring someone has to take their access with it, not wait for the
      // session to expire in thirty days.
      expect(await memberForSession('still-open')).toBeNull();
    } finally {
      await db.member.update({ where: { id: STAFF }, data: { status: 'active' } });
    }
  });

  test('an invented session id is nobody', async () => {
    expect(await memberForSession('made-up')).toBeNull();
    expect(await memberForSession(undefined)).toBeNull();
  });
});

describe('reading the session off a request', () => {
  test('the cookie is found among others', () => {
    expect(sessionIdFromRequest(req(`theme=ink; ${SESSION_COOKIE}=abc123; other=1`))).toBe('abc123');
  });

  test('no cookie header is nobody, not a crash', async () => {
    expect(sessionIdFromRequest(req())).toBeUndefined();
    expect(await viewerFromRequest(req())).toBeNull();
  });

  test('a cookie naming no session is nobody', async () => {
    expect(await viewerFromRequest(req(`${SESSION_COOKIE}=forged`))).toBeNull();
  });

  test('a real session resolves to the member', async () => {
    await db.session.create({
      data: { id: 'real-one', memberId: OWNER, expiresAt: new Date(Date.now() + 60_000) },
    });
    expect((await viewerFromRequest(req(`${SESSION_COOKIE}=real-one`)))?.id).toBe(OWNER);
  });
});

describe('the hash itself', () => {
  // These would have passed against `Bun.password` too. What they add is a
  // guard on the format, since the parameters are stored in the hash so raising
  // them later does not invalidate everyone's password.
  test('two hashes of the same password differ — the salt is real', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/auth');
    const a = await hashPassword('the same password');
    const b = await hashPassword('the same password');

    expect(a).not.toBe(b);
    expect(await verifyPassword('the same password', a)).toBe(true);
    expect(await verifyPassword('the same password', b)).toBe(true);
  });

  test('the hash names its scheme and cost, so they can be raised later', async () => {
    const { hashPassword } = await import('@/lib/auth');
    const [scheme, N, r, p, salt, key] = (await hashPassword('x')).split('$');

    expect(scheme).toBe('scrypt');
    expect(Number(N)).toBeGreaterThanOrEqual(16_384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Buffer.from(salt, 'base64').length).toBe(16);
    expect(Buffer.from(key, 'base64').length).toBe(64);
  });

  test('a truncated or foreign hash fails rather than throwing', async () => {
    const { verifyPassword } = await import('@/lib/auth');
    for (const bad of ['', 'nonsense', 'scrypt$16384$8', '$2b$10$abcdefghijklmnop', 'scrypt$x$y$z$q$w']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  test('unicode is normalised, so the same password typed two ways still works', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/auth');
    // Composed vs decomposed é — the same password to a person.
    const composed = 'café-password';
    const decomposed = 'café-password';

    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });
});
