// Vuno — Users API
// Returns all humans in the org (currently just the CEO Kai for v1).
// Used by the Chats panel (DM list) and Org panel (members roster).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) return NextResponse.json({ users: [] });

  const users = await db.user.findMany({
    where: { tenantId: org.tenantId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      email: true,
      name: true,
      isOrgOwner: true,
    },
  });

  return NextResponse.json({ users });
}
