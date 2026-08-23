// Who is in the org, and how that changes.
//
// The parity rule, tested rather than asserted: a person and an agent are hired
// through the same function and produce the same event. Before this, hiring an
// agent appended `AgentInstalled` and hiring a person appended nothing at all —
// the spine recorded half the org's history.
//
// And every refusal has to say what to do instead. "Invalid input" on a screen
// where you are trying to hire someone is not a usable answer.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { changeRole, hireMember, promoteToColleague, retireMember, RosterError } from '@/lib/members/roster';

const TENANT = 'tnt-roster';
const ORG = 'org-roster';
const DEPT = 'dept-roster';
const TEAM = 'team-roster';
const OWNER = 'mbr-roster-owner';

const base = { tenantId: TENANT, orgId: ORG };

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'roster-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'roster-o' } });
  await db.department.create({ data: { id: DEPT, tenantId: TENANT, orgId: ORG, name: 'Engineering', slug: 'roster-eng' } });
  await db.team.create({
    data: { id: TEAM, tenantId: TENANT, orgId: ORG, departmentId: DEPT, name: 'Engineering', slug: 'roster-eng' },
  });
  await db.member.create({
    data: {
      id: OWNER, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Kai Alvarez', handle: 'roster-kai',
      human: { create: { email: 'kai@roster.test', isOrgOwner: true } },
    },
  });
});

afterEach(async () => {
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.membership.deleteMany({ where: { orgId: ORG, memberId: { not: OWNER } } });
  await db.member.deleteMany({ where: { orgId: ORG, id: { not: OWNER } } });
});

afterAll(async () => {
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.membership.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.team.deleteMany({ where: { orgId: ORG } });
  await db.department.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

async function lastEvent(type: string) {
  const e = await db.event.findFirst({ where: { orgId: ORG, type }, orderBy: { seq: 'desc' } });
  return e ? { ...e, payload: JSON.parse(e.payload as string) as Record<string, unknown> } : null;
}

describe('hiring a person and hiring an agent are the same act', () => {
  test('a person joining is on the spine', async () => {
    await hireMember({ ...base, kind: 'human', displayName: 'Mira Okonkwo', handle: 'mira', teamId: TEAM });

    const joined = await lastEvent('MemberJoined');
    expect(joined!.payload.kind).toBe('human');
    expect(joined!.payload.name).toBe('Mira Okonkwo');
    expect(joined!.payload.teamName).toBe('Engineering');
  });

  test('an agent joining is on the spine, in the same shape', async () => {
    await hireMember({
      ...base, kind: 'agent', displayName: 'Sid', handle: 'sid', role: 'security',
      modelName: 'claude-sonnet-4', harnessName: 'anthropic', teamId: TEAM,
    });

    const joined = await lastEvent('MemberJoined');
    expect(joined!.payload.kind).toBe('agent');
    expect(joined!.payload.harnessName).toBe('anthropic');
    // Same event type as the human — one vocabulary (ADR-0009).
    expect(joined!.type).toBe('MemberJoined');
  });

  test('both land on the same team through the same membership row', async () => {
    await hireMember({ ...base, kind: 'human', displayName: 'Mira', handle: 'mira', teamId: TEAM, teamRole: 'TEAM_LEAD' });
    await hireMember({
      ...base, kind: 'agent', displayName: 'Sid', handle: 'sid',
      modelName: 'm', harnessName: 'anthropic', teamId: TEAM,
    });

    const rows = await db.membership.findMany({ where: { teamId: TEAM }, select: { role: true } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.role).sort()).toEqual(['MEMBER', 'TEAM_LEAD']);
  });
});

describe('hiring refuses in words someone can act on', () => {
  test('a handle already taken names who has it', async () => {
    await hireMember({ ...base, kind: 'human', displayName: 'Mira Okonkwo', handle: 'mira' });
    await expect(
      hireMember({ ...base, kind: 'human', displayName: 'Someone Else', handle: 'mira' }),
    ).rejects.toThrow(/already Mira Okonkwo/);
  });

  test('a handle nobody could type is refused, and says why it matters', async () => {
    await expect(
      hireMember({ ...base, kind: 'human', displayName: 'X', handle: 'Not A Handle!' }),
    ).rejects.toThrow(/after @/);
  });

  test('an agent with no harness is refused, not defaulted to something that cannot run', async () => {
    await expect(
      hireMember({ ...base, kind: 'agent', displayName: 'Ghost', handle: 'ghost' }),
    ).rejects.toThrow(/needs a model and a harness/);
  });

  test('an unknown harness lists the ones that exist', async () => {
    await expect(
      hireMember({
        ...base, kind: 'agent', displayName: 'Ghost', handle: 'ghost',
        modelName: 'm', harnessName: 'simulated',
      }),
    ).rejects.toThrow(/anthropic, ollama/);
  });

  test('a team from another org is refused', async () => {
    await expect(
      hireMember({ ...base, kind: 'human', displayName: 'X', handle: 'x', teamId: 'team-elsewhere' }),
    ).rejects.toThrow(/does not exist in this org/);
  });

  test('a person cannot be made somebody\'s assistant', async () => {
    await expect(
      hireMember({ ...base, kind: 'human', displayName: 'X', handle: 'x', ownerMemberId: OWNER }),
    ).rejects.toThrow(/Only an agent/);
  });
});

describe('promotion and demotion are the same move, recorded either way', () => {
  async function hireOnTeam(handle: string, role: 'MEMBER' | 'TEAM_LEAD' = 'MEMBER') {
    const { id } = await hireMember({
      ...base, kind: 'human', displayName: handle, handle, teamId: TEAM, teamRole: role,
    });
    return id;
  }

  test('a promotion records where it came from and why', async () => {
    const id = await hireOnTeam('mira');
    const moved = await changeRole({ orgId: ORG, memberId: id, to: 'TEAM_LEAD', reason: 'Ran the WAL review end to end' });

    expect(moved).toEqual({ from: 'MEMBER', to: 'TEAM_LEAD' });
    const event = await lastEvent('MemberRoleChanged');
    expect(event!.payload.from).toBe('MEMBER');
    expect(event!.payload.to).toBe('TEAM_LEAD');
    expect(event!.payload.reason).toContain('WAL review');
  });

  test('a demotion is the same event in the other direction', async () => {
    const id = await hireOnTeam('mira', 'TEAM_LEAD');
    await changeRole({ orgId: ORG, memberId: id, to: 'MEMBER', reason: 'Stepping back from the lead role' });

    const event = await lastEvent('MemberRoleChanged');
    expect(event!.payload.from).toBe('TEAM_LEAD');
    expect(event!.payload.to).toBe('MEMBER');
  });

  test('a change with no reason is refused — it goes on the record', async () => {
    const id = await hireOnTeam('mira');
    await expect(changeRole({ orgId: ORG, memberId: id, to: 'TEAM_LEAD', reason: '   ' })).rejects.toThrow(/reason/);
  });

  test('a move to the role they already hold is refused rather than logged as a change', async () => {
    const id = await hireOnTeam('mira');
    await expect(changeRole({ orgId: ORG, memberId: id, to: 'MEMBER', reason: 'no-op' })).rejects.toThrow(/already/);
    expect(await db.event.count({ where: { orgId: ORG, type: 'MemberRoleChanged' } })).toBe(0);
  });

  test('someone on no team has no role to change, and is told so', async () => {
    const { id } = await hireMember({ ...base, kind: 'human', displayName: 'Loose', handle: 'loose' });
    await expect(changeRole({ orgId: ORG, memberId: id, to: 'TEAM_LEAD', reason: 'why not' }))
      .rejects.toThrow(/not on a team/);
  });
});

describe('an assistant can become a colleague', () => {
  async function hireAssistant() {
    const { id } = await hireMember({
      ...base, kind: 'agent', displayName: 'Bob', handle: 'bob', role: 'assistant',
      modelName: 'claude-sonnet-4', harnessName: 'anthropic', ownerMemberId: OWNER,
    });
    return id;
  }

  test('the only thing that made it an assistant was whose it was', async () => {
    const id = await hireAssistant();
    expect((await db.agentProfile.findUnique({ where: { memberId: id } }))!.ownerMemberId).toBe(OWNER);

    await promoteToColleague({ orgId: ORG, memberId: id, reason: 'Doing org-wide work now', teamId: TEAM });

    expect((await db.agentProfile.findUnique({ where: { memberId: id } }))!.ownerMemberId).toBeNull();
    const event = await lastEvent('MemberRoleChanged');
    expect(event!.payload.from).toBe('assistant');
    expect(event!.payload.to).toBe('colleague');
    expect(event!.payload.teamName).toBe('Engineering');
  });

  test('promoting one that already works for the org is refused', async () => {
    const { id } = await hireMember({
      ...base, kind: 'agent', displayName: 'Sid', handle: 'sid',
      modelName: 'm', harnessName: 'anthropic',
    });
    await expect(promoteToColleague({ orgId: ORG, memberId: id, reason: 'x' })).rejects.toThrow(/already works for the org/);
  });

  test('a person is not an assistant', async () => {
    const { id } = await hireMember({ ...base, kind: 'human', displayName: 'Mira', handle: 'mira' });
    await expect(promoteToColleague({ orgId: ORG, memberId: id, reason: 'x' })).rejects.toThrow(/is a person/);
  });
});

describe('retiring a member', () => {
  test('the member is retired, not deleted — they authored events', async () => {
    const { id } = await hireMember({ ...base, kind: 'human', displayName: 'Mira', handle: 'mira', teamId: TEAM });
    await retireMember({ orgId: ORG, memberId: id, reason: 'Left the company' });

    const row = await db.member.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('retired');
    expect(row!.presenceState).toBe('offline');
    // They hold no role while retired.
    expect(await db.membership.count({ where: { memberId: id } })).toBe(0);

    const event = await lastEvent('MemberRetired');
    expect(event!.payload.reason).toBe('Left the company');
  });

  test('an agent is stamped with when it was retired', async () => {
    const { id } = await hireMember({
      ...base, kind: 'agent', displayName: 'Sid', handle: 'sid', modelName: 'm', harnessName: 'anthropic',
    });
    await retireMember({ orgId: ORG, memberId: id, reason: 'Role folded into Verifier' });
    expect((await db.agentProfile.findUnique({ where: { memberId: id } }))!.retiredAt).not.toBeNull();
  });

  test('the org owner cannot be retired — somebody has to answer an escalation', async () => {
    await expect(retireMember({ orgId: ORG, memberId: OWNER, reason: 'no' }))
      .rejects.toThrow(/nobody to answer an escalation/);
  });

  test('retiring someone with an assistant is refused, naming the problem', async () => {
    const { id: person } = await hireMember({ ...base, kind: 'human', displayName: 'Mira', handle: 'mira' });
    await hireMember({
      ...base, kind: 'agent', displayName: 'Ada', handle: 'ada', role: 'assistant',
      modelName: 'm', harnessName: 'anthropic', ownerMemberId: person,
    });

    await expect(retireMember({ orgId: ORG, memberId: person, reason: 'left' }))
      .rejects.toThrow(/answer for someone who has left/);
  });

  test('retiring twice is refused rather than appending a second retirement', async () => {
    const { id } = await hireMember({ ...base, kind: 'human', displayName: 'Mira', handle: 'mira' });
    await retireMember({ orgId: ORG, memberId: id, reason: 'left' });
    await expect(retireMember({ orgId: ORG, memberId: id, reason: 'left again' })).rejects.toThrow(/already retired/);
    expect(await db.event.count({ where: { orgId: ORG, type: 'MemberRetired' } })).toBe(1);
  });

  test('a member from another org is not found', async () => {
    await expect(retireMember({ orgId: ORG, memberId: 'mbr-elsewhere', reason: 'x' }))
      .rejects.toThrow(RosterError);
  });
});
