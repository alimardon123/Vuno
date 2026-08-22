// Vuno — /api/org-info
// Returns the current tenant and org name (v1: first tenant + first org).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      tenantId: true,
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!org) return NextResponse.json({ tenant: null, org: null });
  return NextResponse.json({
    tenant: { id: org.tenant.id, name: org.tenant.name, slug: org.tenant.slug },
    org: { id: org.id, name: org.name, slug: org.slug },
  });
}
