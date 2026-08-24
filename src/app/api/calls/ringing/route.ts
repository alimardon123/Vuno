// Vuno — /api/calls/ringing
//
// What is ringing for the viewer, anywhere in the app. Separate from
// `/api/calls` because it asks a different question: that one is "what is
// happening in this conversation", this one is "is anybody trying to reach me".
//
// Polled rather than streamed. An SSE connection held open from the app shell
// for every signed-in tab is a connection per tab for a thing that happens
// twice a day, and the poll is one indexed query — the cheaper shape wins until
// there is a reason it does not.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { viewerFromRequest } from '@/lib/auth';
import { ringingFor } from '@/lib/calls';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const viewer = await viewerFromRequest(req);
  if (!viewer) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) return NextResponse.json({ ok: true, ringing: [] });

  return NextResponse.json({ ok: true, ringing: await ringingFor(org.id, viewer) });
}
