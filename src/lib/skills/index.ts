// Vuno — the skill library.
//
// A skill is instructions, in the SKILL.md convention rather than a format
// invented here (docs/IA-NAVIGATION.md). Holding one changes what an agent is
// told it knows how to do — `src/lib/agents/turn.ts` reads them on every turn —
// which is what makes assigning one a staffing decision rather than a setting.
//
// MCP connections belong in this same library and are not here yet: a row
// declaring a connection nothing can call would describe a capability the org
// does not have. See docs/REVIEW-2026-08-23.md.

import { db } from '@/lib/db';

export class SkillError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'SkillError';
  }
}

export interface SkillRow {
  id: string;
  key: string;
  name: string;
  summary: string;
  content: string;
  source: string;
  version: string;
  holders: Array<{ id: string; displayName: string; kind: string }>;
}

export async function listSkills(orgId: string): Promise<SkillRow[]> {
  const rows = await db.skill.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
    include: {
      holders: {
        select: { member: { select: { id: true, displayName: true, kind: true, status: true } } },
      },
    },
  });

  return rows.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    summary: s.summary,
    content: s.content,
    source: s.source,
    version: s.version,
    // A retired member keeps the row; the Library shows who is actually using it.
    holders: s.holders
      .map((h) => h.member)
      .filter((m) => m.status === 'active')
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  }));
}

const KEY = /^[a-z0-9][a-z0-9-]{1,60}$/;

export async function createSkill(input: {
  tenantId: string;
  orgId: string;
  key: string;
  name: string;
  summary: string;
  content: string;
}): Promise<{ id: string }> {
  const key = input.key.trim().toLowerCase();
  if (!KEY.test(key)) {
    throw new SkillError(
      `"${input.key}" is not a usable key. Lowercase letters, digits and dashes — an agent package refers to a skill by this.`,
    );
  }
  if (!input.content.trim()) {
    throw new SkillError('A skill with no instructions changes nothing about how an agent works.');
  }

  const taken = await db.skill.findFirst({ where: { orgId: input.orgId, key }, select: { name: true } });
  if (taken) throw new SkillError(`The key "${key}" already belongs to "${taken.name}".`);

  return db.skill.create({
    data: {
      tenantId: input.tenantId,
      orgId: input.orgId,
      key,
      name: input.name.trim(),
      summary: input.summary.trim(),
      content: input.content.trim(),
    },
    select: { id: true },
  });
}

/** Give a skill to a member, or take it back. Idempotent in both directions. */
export async function setSkillHolder(input: {
  orgId: string;
  skillId: string;
  memberId: string;
  held: boolean;
}): Promise<void> {
  const [skill, member] = await Promise.all([
    db.skill.findFirst({ where: { id: input.skillId, orgId: input.orgId }, select: { id: true, tenantId: true } }),
    db.member.findFirst({
      where: { id: input.memberId, orgId: input.orgId },
      select: { id: true, displayName: true, status: true },
    }),
  ]);
  if (!skill) throw new SkillError('That skill is not in this org.', 404);
  if (!member) throw new SkillError('That member is not in this org.', 404);
  if (input.held && member.status !== 'active') {
    throw new SkillError(`${member.displayName} has been retired and cannot take on new work.`);
  }

  if (input.held) {
    await db.memberSkill.upsert({
      where: { memberId_skillId: { memberId: member.id, skillId: skill.id } },
      create: { tenantId: skill.tenantId, orgId: input.orgId, memberId: member.id, skillId: skill.id },
      update: {},
    });
  } else {
    await db.memberSkill.deleteMany({ where: { memberId: member.id, skillId: skill.id } });
  }
}

export async function deleteSkill(orgId: string, skillId: string): Promise<void> {
  const skill = await db.skill.findFirst({
    where: { id: skillId, orgId },
    select: { id: true, name: true, _count: { select: { holders: true } } },
  });
  if (!skill) throw new SkillError('That skill is not in this org.', 404);
  if (skill._count.holders > 0) {
    throw new SkillError(
      `${skill.name} is held by ${skill._count.holders} member${skill._count.holders === 1 ? '' : 's'}. ` +
        'Take it back from them first — removing it silently would change how they work.',
    );
  }
  await db.skill.delete({ where: { id: skillId } });
}
