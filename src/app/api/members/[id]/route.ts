// Vuno — PATCH /api/members/[id]
//
// Promote, demote, promote an assistant to a colleague, retire. One route,
// because they are all the same thing: a change to who someone is in the org,
// which goes on the spine before it goes in the roster.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getOrgOwner } from '@/lib/members';
import { changeRole, promoteToColleague, retireMember, RosterError, TEAM_ROLES } from '@/lib/members/roster';

export const dynamic = 'force-dynamic';

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('change_role'),
    to: z.enum(TEAM_ROLES),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal('promote_to_colleague'),
    reason: z.string().min(1).max(500),
    teamId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    action: z.literal('retire'),
    reason: z.string().min(1).max(500),
  }),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse((await req.json()) as unknown);
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
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  }

  // Who is making the change. It goes on the event, because "who demoted whom"
  // is a question the org should be able to answer.
  const actor = await getOrgOwner(org.id);

  try {
    if (parsed.action === 'change_role') {
      const moved = await changeRole({
        orgId: org.id, memberId: id, to: parsed.to, reason: parsed.reason, actorMemberId: actor?.id,
      });
      return NextResponse.json({ ok: true, ...moved });
    }
    if (parsed.action === 'promote_to_colleague') {
      await promoteToColleague({
        orgId: org.id, memberId: id, reason: parsed.reason,
        teamId: parsed.teamId ?? null, actorMemberId: actor?.id,
      });
      return NextResponse.json({ ok: true });
    }
    await retireMember({ orgId: org.id, memberId: id, reason: parsed.reason, actorMemberId: actor?.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RosterError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
