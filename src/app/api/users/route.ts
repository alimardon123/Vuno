// Vuno — GET /api/users
// Transitional: a filtered view of /api/members, same as /api/agents. New code
// should call /api/members; removed when the shell rebuild lands.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listMembers } from '@/lib/members';

export const dynamic = 'force-dynamic';

export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ users: [] });

  const members = await listMembers(org.id, { kind: 'human' });
  return NextResponse.json({
    users: members.map((m) => ({
      id: m.id,
      name: m.displayName,
      handle: m.handle,
      isOrgOwner: m.isOrgOwner,
      teamId: m.teamId,
      presenceState: m.presenceState,
      presenceNote: m.presenceNote,
    })),
  });
}
