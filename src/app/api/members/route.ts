// Vuno — /api/members
//
// One roster, one route. Humans and agents come back in the same list and are
// hired through the same call, because they are the same table (ADR-0009).
// Hiring an agent used to live at /api/install and append `AgentInstalled`,
// while hiring a person had no route at all and appended nothing.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { listMembers, type MemberKind } from '@/lib/members';
import { hireMember, RosterError, TEAM_ROLES } from '@/lib/members/roster';

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

const hireSchema = z.object({
  kind: z.enum(['human', 'agent']),
  displayName: z.string().min(1).max(120),
  handle: z.string().min(1).max(39),
  teamId: z.string().min(1).nullable().optional(),
  teamRole: z.enum(TEAM_ROLES).optional(),
  email: z.string().email().optional(),
  role: z.string().min(1).max(60).optional(),
  modelName: z.string().min(1).max(120).optional(),
  harnessName: z.string().min(1).max(120).optional(),
  ownerMemberId: z.string().min(1).nullable().optional(),
  actorMemberId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof hireSchema>;
  try {
    parsed = hireSchema.parse((await req.json()) as unknown);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof z.ZodError
            ? e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
            : 'Invalid body',
      },
      { status: 400 },
    );
  }

  const org = await db.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, tenantId: true },
  });
  if (!org) {
    return NextResponse.json({ ok: false, error: 'No organisation found. Seed the database first.' }, { status: 409 });
  }

  try {
    const { id } = await hireMember({ tenantId: org.tenantId, orgId: org.id, ...parsed });
    return NextResponse.json({ ok: true, memberId: id });
  } catch (e) {
    if (e instanceof RosterError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
