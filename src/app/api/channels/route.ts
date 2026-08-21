import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/channels
export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) return NextResponse.json({ channels: [], departments: [], teams: [] });

  const channels = await db.channel.findMany({
    where: { orgId: org.id },
    orderBy: { name: 'asc' },
  });
  const departments = await db.department.findMany({
    where: { orgId: org.id },
    orderBy: { name: 'asc' },
  });
  const teams = await db.team.findMany({
    where: { orgId: org.id },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ channels, departments, teams });
}
