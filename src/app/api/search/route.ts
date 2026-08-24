// Vuno — /api/search
//
// The search field asks this while you type, so it answers to the viewer's
// session and nothing else: there is no `orgId` or `memberId` parameter to pass
// somebody else's. A search endpoint that took whose results to return would be
// a way to read any DM in the org with a fetch call.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { search } from '@/lib/search';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in to search.' }, { status: 401 });

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation.' }, { status: 404 });

  const q = new URL(req.url).searchParams.get('q') ?? '';
  const results = await search(org.id, viewer, q);
  return NextResponse.json({ ok: true, ...results });
}
