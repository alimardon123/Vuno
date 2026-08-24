// Vuno — who is signed in.
//
// There was no authentication at all: `getOrgOwner()` stood in for "who is
// viewing" in a dozen places, so whoever reached the port was the org owner and
// could post as them, hire, retire and read every DM. `next-auth` was in the
// dependencies and wired to nothing.
//
// The shape here is deliberately small. A session is a row, not a self-contained
// token, because signing someone out has to actually sign them out — a token you
// cannot revoke is a password with an expiry date.
//
// Passwords use scrypt from Node's own crypto, not `Bun.password`. Bun's is
// nicer, and it is not there: Next runs route handlers in a Node-compatible
// runtime, so `Bun` is undefined inside the app even though the process was
// started with bun. Every auth test passed against a broken app, because
// `bun:test` *is* Bun — a gap the browser check now covers.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getMember, type MemberSummary } from '@/lib/members';

export const SESSION_COOKIE = 'vuno_session';
const SESSION_DAYS = 30;

/** Long enough that guessing one is not a strategy. */
function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Cost parameters, stored in the hash so raising them later does not invalidate
// every existing password. maxmem has to be above 128 * N * r or Node refuses.
const SCRYPT = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const [scheme, N, r, p, salt, expected] = stored.split('$');
    if (scheme !== 'scrypt') return false;

    const expectedKey = Buffer.from(expected, 'base64');
    const key = await scryptAsync(plain.normalize('NFKC'), Buffer.from(salt, 'base64'), expectedKey.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    // Constant time: a comparison that returns early leaks how much of the hash
    // matched, one byte at a time.
    return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
  } catch {
    // A malformed or truncated hash is a failed sign-in, not a crash.
    return false;
  }
}

export interface SignInResult {
  ok: boolean;
  /** Why not, in words someone can act on. Never which half was wrong. */
  error?: string;
  sessionId?: string;
  memberId?: string;
}

/**
 * Sign in by email and password.
 *
 * The failure message is the same whether the email is unknown or the password
 * is wrong: telling someone which half they got right is how an account list
 * gets enumerated.
 */
export async function signIn(email: string, password: string, userAgent?: string): Promise<SignInResult> {
  const wrong = { ok: false as const, error: 'That email and password do not match an account.' };

  const profile = await db.humanProfile.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { memberId: true, passwordHash: true, member: { select: { status: true } } },
  });

  if (!profile?.passwordHash) {
    // Still spend the time hashing, so a missing account and a wrong password
    // do not take visibly different amounts of it.
    await hashPassword(password);
    return wrong;
  }
  if (!(await verifyPassword(password, profile.passwordHash))) return wrong;
  if (profile.member.status !== 'active') {
    return { ok: false, error: 'That account has been retired. Ask the org owner to restore it.' };
  }

  const sessionId = newSessionId();
  await db.session.create({
    data: {
      id: sessionId,
      memberId: profile.memberId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 3_600_000),
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });

  return { ok: true, sessionId, memberId: profile.memberId };
}

export async function signOut(sessionId: string): Promise<void> {
  await db.session.deleteMany({ where: { id: sessionId } });
}

/** Every session for this member, so signing out everywhere is possible. */
export async function signOutEverywhere(memberId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { memberId } });
  return count;
}

/** The member this session belongs to, or null. Expired sessions are cleaned up. */
export async function memberForSession(sessionId: string | undefined): Promise<MemberSummary | null> {
  if (!sessionId) return null;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { id: true, memberId: true, expiresAt: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  const member = await getMember(session.memberId);
  return member?.status === 'active' ? member : null;
}

/**
 * Who is viewing, for a server component.
 *
 * Every surface that used to call `getOrgOwner()` calls this or its request
 * form. The difference matters most in Chats: a DM names itself from whoever is
 * reading it, and with one hardcoded viewer that was always the same person.
 */
export async function currentViewer(): Promise<MemberSummary | null> {
  const jar = await cookies();
  return memberForSession(jar.get(SESSION_COOKIE)?.value);
}

/** Read the session cookie off a request header. */
export function sessionIdFromRequest(req: Request): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Who is viewing, for a route handler.
 *
 * A route reads the session from the request it was handed rather than from
 * ambient storage: `cookies()` only resolves inside a rendering scope, so a
 * route that used it could not be called directly — including by a test, which
 * is exactly where the auth path most needs exercising.
 */
export async function viewerFromRequest(req: Request): Promise<MemberSummary | null> {
  return memberForSession(sessionIdFromRequest(req));
}

/** True when nobody can sign in yet — the first run of a seeded org. */
export async function needsFirstRun(orgId: string): Promise<boolean> {
  const withPassword = await db.humanProfile.count({
    where: { passwordHash: { not: null }, member: { orgId } },
  });
  return withPassword === 0;
}

export interface ClaimResult {
  ok: boolean;
  error?: string;
  sessionId?: string;
}

/**
 * First run: set the password on the org owner's account.
 *
 * Only possible while no account in the org has a password. After that this
 * route is closed, so it cannot be used to take over an org later.
 */
export async function claimOwnerAccount(
  orgId: string,
  password: string,
  userAgent?: string,
): Promise<ClaimResult> {
  if (!(await needsFirstRun(orgId))) {
    return { ok: false, error: 'This org already has an account. Sign in instead.' };
  }
  if (password.length < 8) {
    return { ok: false, error: 'Use at least 8 characters — this is the only thing between the org and anyone who can reach the port.' };
  }

  const owner = await db.humanProfile.findFirst({
    where: { isOrgOwner: true, member: { orgId } },
    select: { memberId: true },
  });
  if (!owner) {
    return { ok: false, error: 'No org owner exists to claim. Run `bun run seed` first.' };
  }

  await db.humanProfile.update({
    where: { memberId: owner.memberId },
    data: { passwordHash: await hashPassword(password) },
  });

  const sessionId = newSessionId();
  await db.session.create({
    data: {
      id: sessionId,
      memberId: owner.memberId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 3_600_000),
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });
  return { ok: true, sessionId };
}

/** Give a member a password, so they can sign in. Used when hiring a person. */
export async function setPassword(memberId: string, password: string): Promise<void> {
  await db.humanProfile.update({
    where: { memberId },
    data: { passwordHash: await hashPassword(password) },
  });
}

/** Housekeeping: expired rows are worth removing, not just ignoring. */
export async function pruneSessions(): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
