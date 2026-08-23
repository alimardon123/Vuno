// Vuno — changing who is in the org.
//
// Hiring, retiring and changing someone's role, for a person and for an agent
// through the same functions. There used to be `/api/install`, which only
// installed agents and appended `AgentInstalled`; hiring a person appended
// nothing at all, so the spine recorded half the org's history. Parity is a
// schema property, and the event vocabulary is part of the schema (ADR-0009).
//
// Every change is an event first. The roster is a projection of them, which is
// why "when did this person join" and "who demoted whom, and why" are questions
// the org can actually answer.

import { db } from '@/lib/db';
import { EventSpine } from '@/lib/events/spine';
import { HARNESSES } from '@/lib/agents/registry';

export type MemberKind = 'human' | 'agent';

/** Roles inside a team. Ordered, because promotion and demotion are movement along it. */
export const TEAM_ROLES = ['MEMBER', 'TEAM_LEAD', 'DEPARTMENT_HEAD', 'ORG_OWNER'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_RANK: Record<string, number> = {
  MEMBER: 0,
  HR_META: 0,
  TEAM_LEAD: 1,
  DEPARTMENT_HEAD: 2,
  ORG_OWNER: 3,
};

export class RosterError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'RosterError';
  }
}

export interface HireInput {
  tenantId: string;
  orgId: string;
  kind: MemberKind;
  displayName: string;
  handle: string;
  teamId?: string | null;
  teamRole?: TeamRole;
  /** Humans: how to reach them. Agents: what runs them. */
  email?: string;
  role?: string;
  modelName?: string;
  harnessName?: string;
  /** Set to make this member somebody's assistant. */
  ownerMemberId?: string | null;
  /** Who is doing the hiring. */
  actorMemberId?: string;
}

const HANDLE = /^[a-z0-9][a-z0-9._-]{0,38}$/;

export async function hireMember(input: HireInput): Promise<{ id: string }> {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) {
    throw new RosterError(
      `"${input.handle}" is not a usable handle. Use lowercase letters, digits, dot, dash or underscore — it is what people type after @.`,
    );
  }

  const taken = await db.member.findFirst({
    where: { orgId: input.orgId, handle },
    select: { displayName: true },
  });
  if (taken) throw new RosterError(`@${handle} is already ${taken.displayName}.`);

  if (input.kind === 'agent') {
    const harness = input.harnessName?.trim();
    if (!harness || !input.modelName?.trim()) {
      throw new RosterError(
        `An agent needs a model and a harness — naming what will run it is part of hiring it. Harnesses: ${HARNESSES.join(', ')}.`,
      );
    }
    if (!(HARNESSES as readonly string[]).includes(harness)) {
      throw new RosterError(`Unknown harness "${harness}". This install can run: ${HARNESSES.join(', ')}.`);
    }
  }

  if (input.ownerMemberId) {
    const owner = await db.member.findFirst({
      where: { id: input.ownerMemberId, orgId: input.orgId },
      select: { id: true },
    });
    if (!owner) throw new RosterError('That owner is not a member of this org.');
    if (input.kind !== 'agent') {
      throw new RosterError('Only an agent can be somebody\'s assistant.');
    }
  }

  const team = input.teamId
    ? await db.team.findFirst({ where: { id: input.teamId, orgId: input.orgId }, select: { id: true, name: true } })
    : null;
  if (input.teamId && !team) throw new RosterError('That team does not exist in this org.');

  const member = await db.member.create({
    data: {
      tenantId: input.tenantId,
      orgId: input.orgId,
      kind: input.kind,
      displayName: input.displayName.trim(),
      handle,
      teamId: team?.id ?? null,
      status: 'active',
      presenceState: input.kind === 'agent' ? 'available' : 'offline',
      ...(input.kind === 'human'
        ? { human: { create: { email: input.email?.trim() || `${handle}@local`, isOrgOwner: false } } }
        : {
            agent: {
              create: {
                role: input.role?.trim() || 'agent',
                modelName: input.modelName!.trim(),
                harnessName: input.harnessName!.trim(),
                ownerMemberId: input.ownerMemberId ?? null,
              },
            },
          }),
    },
    select: { id: true, displayName: true, kind: true },
  });

  if (team) {
    await db.membership.create({
      data: {
        tenantId: input.tenantId,
        orgId: input.orgId,
        teamId: team.id,
        memberId: member.id,
        role: input.teamRole ?? 'MEMBER',
      },
    });
  }

  const ownerName = input.ownerMemberId
    ? (await db.member.findUnique({ where: { id: input.ownerMemberId }, select: { displayName: true } }))?.displayName
    : undefined;

  const spine = new EventSpine(input.tenantId, input.orgId);
  await spine.append([
    {
      type: 'MemberJoined',
      actorType: input.actorMemberId ? 'member' : 'system',
      actorMemberId: input.actorMemberId,
      scopeType: 'org',
      scopeId: input.orgId,
      payload: {
        memberId: member.id,
        name: member.displayName,
        kind: input.kind,
        role: input.kind === 'agent' ? (input.role?.trim() || 'agent') : (input.teamRole ?? 'MEMBER'),
        ...(team ? { teamId: team.id, teamName: team.name } : {}),
        ...(input.kind === 'agent'
          ? { modelName: input.modelName!.trim(), harnessName: input.harnessName!.trim() }
          : {}),
        ...(input.ownerMemberId ? { ownerMemberId: input.ownerMemberId, ownerName } : {}),
      },
    },
  ]);

  return { id: member.id };
}

export interface RoleChangeInput {
  orgId: string;
  memberId: string;
  to: TeamRole;
  reason: string;
  actorMemberId?: string;
}

/**
 * Promote or demote. One function, because they are the same move in opposite
 * directions and splitting them would let the two drift.
 */
export async function changeRole(input: RoleChangeInput): Promise<{ from: string; to: string }> {
  const member = await requireMember(input.orgId, input.memberId);
  if (member.status !== 'active') {
    throw new RosterError(`${member.displayName} has been retired and holds no role.`);
  }

  const membership = await db.membership.findFirst({
    where: { orgId: input.orgId, memberId: input.memberId },
    select: { id: true, role: true, teamId: true, team: { select: { name: true } } },
  });
  if (!membership) {
    throw new RosterError(`${member.displayName} is not on a team, so there is no role to change.`);
  }
  if (membership.role === input.to) {
    throw new RosterError(`${member.displayName} is already ${input.to.replace(/_/g, ' ').toLowerCase()}.`);
  }
  if (!input.reason.trim()) {
    throw new RosterError('A role change needs a reason — it goes on the record.');
  }

  await db.membership.update({ where: { id: membership.id }, data: { role: input.to } });

  const spine = new EventSpine(member.tenantId, input.orgId);
  await spine.append([
    {
      type: 'MemberRoleChanged',
      actorType: input.actorMemberId ? 'member' : 'system',
      actorMemberId: input.actorMemberId,
      scopeType: 'org',
      scopeId: input.orgId,
      payload: {
        memberId: member.id,
        name: member.displayName,
        from: membership.role,
        to: input.to,
        teamId: membership.teamId,
        teamName: membership.team?.name,
        reason: input.reason.trim(),
      },
    },
  ]);

  return { from: membership.role, to: input.to };
}

/**
 * An assistant becomes a colleague.
 *
 * The mechanic the IA singles out: an assistant works for one person and sees
 * what they see; a colleague works for the org. It is one column, because the
 * only thing that made it an assistant was whose it was.
 */
export async function promoteToColleague(input: {
  orgId: string;
  memberId: string;
  reason: string;
  teamId?: string | null;
  actorMemberId?: string;
}): Promise<void> {
  const member = await requireMember(input.orgId, input.memberId);
  const agent = await db.agentProfile.findUnique({
    where: { memberId: input.memberId },
    select: { ownerMemberId: true, role: true },
  });
  if (!agent) throw new RosterError(`${member.displayName} is a person, not an assistant.`);
  if (!agent.ownerMemberId) throw new RosterError(`${member.displayName} already works for the org.`);
  if (!input.reason.trim()) throw new RosterError('Promoting an assistant needs a reason — it goes on the record.');

  const team = input.teamId
    ? await db.team.findFirst({ where: { id: input.teamId, orgId: input.orgId }, select: { id: true, name: true } })
    : null;
  if (input.teamId && !team) throw new RosterError('That team does not exist in this org.');

  await db.agentProfile.update({ where: { memberId: input.memberId }, data: { ownerMemberId: null } });
  if (team) {
    await db.member.update({ where: { id: input.memberId }, data: { teamId: team.id } });
    await db.membership.upsert({
      where: { teamId_memberId: { teamId: team.id, memberId: input.memberId } },
      create: {
        tenantId: member.tenantId, orgId: input.orgId, teamId: team.id,
        memberId: input.memberId, role: 'MEMBER',
      },
      update: {},
    });
  }

  const spine = new EventSpine(member.tenantId, input.orgId);
  await spine.append([
    {
      type: 'MemberRoleChanged',
      actorType: input.actorMemberId ? 'member' : 'system',
      actorMemberId: input.actorMemberId,
      scopeType: 'org',
      scopeId: input.orgId,
      payload: {
        memberId: member.id,
        name: member.displayName,
        from: 'assistant',
        to: 'colleague',
        ...(team ? { teamId: team.id, teamName: team.name } : {}),
        reason: input.reason.trim(),
      },
    },
  ]);
}

export async function retireMember(input: {
  orgId: string;
  memberId: string;
  reason: string;
  actorMemberId?: string;
}): Promise<void> {
  const member = await requireMember(input.orgId, input.memberId);
  if (member.status === 'retired') throw new RosterError(`${member.displayName} is already retired.`);
  if (!input.reason.trim()) throw new RosterError('Retiring a member needs a reason — it goes on the record.');

  const human = await db.humanProfile.findUnique({
    where: { memberId: input.memberId },
    select: { isOrgOwner: true },
  });
  if (human?.isOrgOwner) {
    throw new RosterError('The org owner cannot be retired — there would be nobody to answer an escalation.');
  }

  const assistants = await db.agentProfile.count({ where: { ownerMemberId: input.memberId } });
  if (assistants > 0) {
    throw new RosterError(
      `${member.displayName} still has ${assistants} assistant${assistants === 1 ? '' : 's'}. ` +
        'Promote or retire them first, or they answer for someone who has left.',
    );
  }

  // Retired, not deleted: the member authored events and may carry a claim's
  // provenance, and the spine is append-only (ADR-0004).
  await db.member.update({
    where: { id: input.memberId },
    data: { status: 'retired', presenceState: 'offline', presenceNote: null },
  });
  await db.membership.deleteMany({ where: { orgId: input.orgId, memberId: input.memberId } });
  if (member.kind === 'agent') {
    await db.agentProfile.update({ where: { memberId: input.memberId }, data: { retiredAt: new Date() } });
  }

  const spine = new EventSpine(member.tenantId, input.orgId);
  await spine.append([
    {
      type: 'MemberRetired',
      actorType: input.actorMemberId ? 'member' : 'system',
      actorMemberId: input.actorMemberId,
      scopeType: 'org',
      scopeId: input.orgId,
      payload: { memberId: member.id, name: member.displayName, reason: input.reason.trim() },
    },
  ]);
}

async function requireMember(orgId: string, memberId: string) {
  const member = await db.member.findFirst({
    where: { id: memberId, orgId },
    select: { id: true, tenantId: true, displayName: true, kind: true, status: true },
  });
  if (!member) throw new RosterError('That member is not in this org.', 404);
  return member;
}
