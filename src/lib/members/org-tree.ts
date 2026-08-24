// Vuno — the org, as a shape rather than a list.
//
// Department → team → member is already in the schema; the roster just never
// showed it. Two things read from here: the roster's grouped view, and the
// topology graph.
//
// One rule the flat roster let slip. A member with no team is not a rendering
// edge case — in a seeded org it is most of them, and in a real one it is
// everybody who has been hired and not placed yet. They get a group of their
// own called what they are, rather than being dropped from a view that claims
// to show the org.

import { db } from '@/lib/db';
import { roleLabel, type MemberSummary } from '@/lib/members';

export interface TeamNode {
  id: string;
  name: string;
  /** The member leading it, if one is marked. */
  lead: { id: string; displayName: string } | null;
  members: OrgMember[];
}

export interface DepartmentNode {
  id: string;
  name: string;
  teams: TeamNode[];
  /** Everyone in the department, across its teams. */
  headcount: { people: number; agents: number };
}

export interface OrgMember extends MemberSummary {
  teamRole: string | null;
  teamRoleLabel: string | null;
}

export interface OrgTree {
  departments: DepartmentNode[];
  /** Hired and not placed. Named, not hidden. */
  unassigned: OrgMember[];
  totals: { departments: number; teams: number; people: number; agents: number };
}

const ROLE_LABEL: Record<string, string> = {
  ORG_OWNER: 'Owner',
  DEPARTMENT_HEAD: 'Department head',
  TEAM_LEAD: 'Team lead',
  HR_META: 'HR / Meta',
  MEMBER: 'Member',
};

export async function orgTree(orgId: string): Promise<OrgTree> {
  const [departments, members, memberships] = await Promise.all([
    db.department.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
      include: { teams: { orderBy: { name: 'asc' } } },
    }),
    db.member.findMany({
      where: { orgId, status: 'active' },
      orderBy: { displayName: 'asc' },
      include: {
        agent: { select: { role: true, ownerMemberId: true } },
        human: { select: { isOrgOwner: true } },
      },
    }),
    db.membership.findMany({ where: { orgId }, select: { teamId: true, memberId: true, role: true } }),
  ]);

  const byId = new Map(
    members.map((m): [string, OrgMember] => [
      m.id,
      {
        id: m.id,
        kind: m.kind as MemberSummary['kind'],
        displayName: m.displayName,
        handle: m.handle,
        role: m.agent?.role ?? null,
        status: m.status,
        presenceState: m.presenceState as MemberSummary['presenceState'],
        presenceNote: m.presenceNote,
        teamId: null,
        ownerMemberId: m.agent?.ownerMemberId ?? null,
        ownerName: null,
        isOrgOwner: m.human?.isOrgOwner ?? false,
        teamRole: null,
        teamRoleLabel: null,
      },
    ]),
  );

  // An assistant renders with whose it is, the same as everywhere else
  // (ADR-0009 §1) — the graph is where "who works for whom" is the question.
  for (const m of byId.values()) {
    if (m.ownerMemberId) m.ownerName = byId.get(m.ownerMemberId)?.displayName ?? null;
  }

  const placed = new Set<string>();
  const perTeam = new Map<string, OrgMember[]>();
  const leadOf = new Map<string, { id: string; displayName: string }>();

  for (const link of memberships) {
    const member = byId.get(link.memberId);
    if (!member) continue;
    placed.add(link.memberId);

    const seated: OrgMember = {
      ...member,
      teamId: link.teamId,
      teamRole: link.role,
      teamRoleLabel: ROLE_LABEL[link.role] ?? link.role,
    };
    const list = perTeam.get(link.teamId) ?? [];
    list.push(seated);
    perTeam.set(link.teamId, list);

    if (link.role === 'TEAM_LEAD' || link.role === 'DEPARTMENT_HEAD') {
      leadOf.set(link.teamId, { id: member.id, displayName: member.displayName });
    }
  }

  // Leads first, then everyone alphabetically — a team where the lead is
  // buried in the middle of a list is a team you have to read to understand.
  const rank = (m: OrgMember) =>
    m.teamRole === 'DEPARTMENT_HEAD' ? 0 : m.teamRole === 'TEAM_LEAD' ? 1 : 2;
  for (const list of perTeam.values()) {
    list.sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName));
  }

  const nodes: DepartmentNode[] = departments.map((d) => {
    const teams: TeamNode[] = d.teams.map((t) => ({
      id: t.id,
      name: t.name,
      lead: leadOf.get(t.id) ?? null,
      members: perTeam.get(t.id) ?? [],
    }));
    const all = teams.flatMap((t) => t.members);
    return {
      id: d.id,
      name: d.name,
      teams,
      headcount: {
        people: all.filter((m) => m.kind === 'human').length,
        agents: all.filter((m) => m.kind === 'agent').length,
      },
    };
  });

  const unassigned = [...byId.values()]
    .filter((m) => !placed.has(m.id))
    .map((m) => ({ ...m, teamRole: null, teamRoleLabel: null }));

  return {
    departments: nodes,
    unassigned,
    totals: {
      departments: nodes.length,
      teams: nodes.reduce((n, d) => n + d.teams.length, 0),
      people: [...byId.values()].filter((m) => m.kind === 'human').length,
      agents: [...byId.values()].filter((m) => m.kind === 'agent').length,
    },
  };
}

/** The agent's role, in the words the roster uses. */
export function memberRoleLabel(m: OrgMember): string | null {
  return m.role ? roleLabel(m.role) : null;
}
