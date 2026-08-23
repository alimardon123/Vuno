// Vuno — /api/skills
//
// The Library. A skill is instructions an agent can hold; holding one changes
// what it is told, which is why assignment lives here and not in a settings
// panel.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createSkill, deleteSkill, listSkills, setSkillHolder, SkillError } from '@/lib/skills';

export const dynamic = 'force-dynamic';

async function currentOrg() {
  return db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true } });
}

function fail(e: unknown) {
  if (e instanceof SkillError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }
  throw e;
}

export async function GET() {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ skills: [] });
  return NextResponse.json({ skills: await listSkills(org.id) });
}

const createBody = z.object({
  key: z.string().min(2).max(60),
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(240),
  content: z.string().min(1).max(20_000),
});

export async function POST(req: Request) {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  try {
    const parsed = createBody.parse((await req.json()) as unknown);
    const { id } = await createSkill({ tenantId: org.tenantId, orgId: org.id, ...parsed });
    return NextResponse.json({ ok: true, skillId: id });
  } catch (e) {
    return fail(e);
  }
}

const patchBody = z.object({
  skillId: z.string().min(1),
  memberId: z.string().min(1),
  held: z.boolean(),
});

export async function PATCH(req: Request) {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  try {
    const parsed = patchBody.parse((await req.json()) as unknown);
    await setSkillHolder({ orgId: org.id, ...parsed });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const org = await currentOrg();
  if (!org) return NextResponse.json({ ok: false, error: 'No organisation found.' }, { status: 409 });
  const skillId = new URL(req.url).searchParams.get('skillId');
  if (!skillId) return NextResponse.json({ ok: false, error: 'skillId is required.' }, { status: 400 });
  try {
    await deleteSkill(org.id, skillId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
