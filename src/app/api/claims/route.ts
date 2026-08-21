import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/claims?scopeType=project&scopeId=<id>&status=<status>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const scopeType = params.get('scopeType') ?? undefined;
  const scopeId = params.get('scopeId') ?? undefined;
  const status = params.get('status') ?? undefined;

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, id: true },
  });
  if (!org) return NextResponse.json({ claims: [] });

  const where: Record<string, unknown> = { orgId: org.id };
  if (scopeType) where.scopeType = scopeType;
  if (scopeId) where.scopeId = scopeId;
  if (status) where.status = status;

  const claims = await db.claim.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    claims: claims.map((c) => ({
      ...c,
      evidenceIds: JSON.parse(c.evidenceIds),
      contradictsIds: JSON.parse(c.contradictsIds),
    })),
  });
}
