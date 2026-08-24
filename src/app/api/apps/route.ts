// Vuno — /api/apps
//
// Adding or removing an app changes what everyone in the org sees, so it is an
// action the viewer takes rather than a preference stored per browser.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { AppError, appsFor, setApp } from '@/lib/apps';

export const dynamic = 'force-dynamic';

const body = z.object({ key: z.string().min(1).max(60), on: z.boolean() });

export async function GET(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  return NextResponse.json({ apps: await appsFor(org.id) });
}

export async function POST(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });

  try {
    const { key, on } = body.parse((await req.json()) as unknown);
    await setApp({ tenantId: org.tenantId, orgId: org.id, key, on, memberId: viewer.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: e.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
    }
    throw e;
  }
}
