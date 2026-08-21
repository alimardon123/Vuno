import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/agents?teamId=<id>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const teamId = params.get('teamId') ?? undefined;

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) return NextResponse.json({ agents: [] });

  const where: Record<string, unknown> = { orgId: org.id, status: 'active' };
  if (teamId) where.teamId = teamId;

  const agents = await db.agent.findMany({
    where,
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    take: 200,
  });

  return NextResponse.json({
    agents: agents.map((a) => ({
      ...a,
      tools: JSON.parse(a.tools),
      permissions: JSON.parse(a.permissions),
    })),
  });
}
