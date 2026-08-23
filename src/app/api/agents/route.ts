// Vuno — GET /api/agents
// Transitional: a filtered view of /api/members kept so surfaces written before
// the Member migration keep working. New code should call /api/members.
// Removed when the shell rebuild lands.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listMembers } from '@/lib/members';

export const dynamic = 'force-dynamic';

export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ agents: [] });

  const members = await listMembers(org.id, { kind: 'agent' });
  return NextResponse.json({
    agents: members.map((m) => ({
      id: m.id,
      name: m.displayName,
      role: m.role ?? 'agent',
      status: m.status,
      kind: m.ownerMemberId ? 'personal_assistant' : 'independent',
      ownerName: m.ownerName,
      teamId: m.teamId,
      presenceState: m.presenceState,
      presenceNote: m.presenceNote,
    })),
  });
}
