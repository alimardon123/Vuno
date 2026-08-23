// Vuno — GET /api/members
// One roster. Humans and agents come back in the same list with the same shape,
// because they are the same table (ADR-0009). Filter with ?kind=human|agent.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listMembers, type MemberKind } from '@/lib/members';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ members: [] });

  const kindParam = new URL(req.url).searchParams.get('kind');
  const kind: MemberKind | undefined =
    kindParam === 'human' || kindParam === 'agent' ? kindParam : undefined;

  const members = await listMembers(org.id, { kind });
  return NextResponse.json({ members });
}
