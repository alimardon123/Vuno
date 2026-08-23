// Vuno — member resolution (ADR-0009)
//
// One place that answers "who is this" for humans and agents alike. Before the
// Member migration, thirteen files each resolved actors their own way — some
// joining Agent, some looking up User, some giving up and rendering an id — and
// a claim made by a person had nowhere to record who they were.
//
// Everything that renders an actor reads through here.

import { db } from '@/lib/db';

export type MemberKind = 'human' | 'agent';

export type PresenceState = 'available' | 'busy' | 'away' | 'offline' | 'dnd';

/** What a surface needs to render a member. Identical shape for both kinds. */
export interface MemberSummary {
  id: string;
  kind: MemberKind;
  displayName: string;
  handle: string;
  /** The agent's role, or the human's title. Rendered the same way. */
  role: string | null;
  status: string;
  presenceState: PresenceState;
  presenceNote: string | null;
  teamId: string | null;
  /** Set only for a personal assistant: the member it works for. */
  ownerMemberId: string | null;
  ownerName: string | null;
  isOrgOwner: boolean;
}

const SELECT = {
  id: true,
  kind: true,
  displayName: true,
  handle: true,
  status: true,
  presenceState: true,
  presenceNote: true,
  teamId: true,
  human: { select: { isOrgOwner: true, email: true } },
  agent: {
    select: {
      role: true,
      ownerMemberId: true,
      modelName: true,
      harnessName: true,
      owner: { select: { displayName: true } },
    },
  },
} as const;

type Row = {
  id: string;
  kind: string;
  displayName: string;
  handle: string;
  status: string;
  presenceState: string;
  presenceNote: string | null;
  teamId: string | null;
  human: { isOrgOwner: boolean; email: string } | null;
  agent: {
    role: string;
    ownerMemberId: string | null;
    modelName: string;
    harnessName: string;
    owner: { displayName: string } | null;
  } | null;
};

function toSummary(row: Row): MemberSummary {
  return {
    id: row.id,
    kind: row.kind === 'agent' ? 'agent' : 'human',
    displayName: row.displayName,
    handle: row.handle,
    role: row.agent?.role ?? null,
    status: row.status,
    presenceState: (row.presenceState as PresenceState) ?? 'offline',
    presenceNote: row.presenceNote,
    teamId: row.teamId,
    ownerMemberId: row.agent?.ownerMemberId ?? null,
    ownerName: row.agent?.owner?.displayName ?? null,
    isOrgOwner: row.human?.isOrgOwner ?? false,
  };
}

/** Every member of an org, humans and agents together, in one list. */
export async function listMembers(
  orgId: string,
  opts: { kind?: MemberKind; includeRetired?: boolean } = {},
): Promise<MemberSummary[]> {
  const rows = await db.member.findMany({
    where: {
      orgId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.includeRetired ? {} : { status: 'active' }),
    },
    orderBy: [{ kind: 'asc' }, { displayName: 'asc' }],
    select: SELECT,
  });
  return (rows as Row[]).map(toSummary);
}

/**
 * A lookup keyed by member id, for rendering a list of events without an N+1.
 * Pass the ids you actually saw; this does not fetch the whole org.
 */
export async function memberMap(ids: string[]): Promise<Map<string, MemberSummary>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.member.findMany({ where: { id: { in: unique } }, select: SELECT });
  return new Map((rows as Row[]).map((r) => [r.id, toSummary(r)]));
}

export async function getMember(id: string): Promise<MemberSummary | null> {
  const row = await db.member.findUnique({ where: { id }, select: SELECT });
  return row ? toSummary(row as Row) : null;
}

/** The org owner — the human an escalation ultimately reaches. */
export async function getOrgOwner(orgId: string): Promise<MemberSummary | null> {
  const row = await db.member.findFirst({
    where: { orgId, kind: 'human', human: { isOrgOwner: true } },
    select: SELECT,
  });
  return row ? toSummary(row as Row) : null;
}

/** A member's personal assistant, if they have one. */
export async function getAssistantFor(ownerMemberId: string): Promise<MemberSummary | null> {
  const row = await db.member.findFirst({
    where: { kind: 'agent', status: 'active', agent: { ownerMemberId } },
    select: SELECT,
  });
  return row ? toSummary(row as Row) : null;
}

/**
 * How a member is labelled wherever their name appears. An assistant reads as
 * itself with the chip that says whose it is — never as its owner (ADR-0009 §1).
 */
export function memberLabel(m: MemberSummary): { name: string; chip: string | null } {
  if (m.kind === 'human') {
    return { name: m.displayName, chip: m.isOrgOwner ? 'owner' : null };
  }
  return {
    name: m.displayName,
    chip: m.ownerName ? `${m.ownerName}'s assistant` : (m.role ?? 'agent'),
  };
}

/**
 * Name-and-role lookup for every member of an org, keyed by id.
 *
 * Nine routes previously did `db.agent.findMany` and built this map themselves,
 * which meant every one of them silently omitted humans — a message from a
 * person rendered without a name, and HR scored nobody. Callers that used to
 * ask for agents now get the whole roster, which is the point.
 */
export async function actorLookup(
  orgId: string,
): Promise<Map<string, { id: string; name: string; role: string | null; kind: MemberKind }>> {
  const rows = await db.member.findMany({
    where: { orgId },
    select: { id: true, displayName: true, kind: true, agent: { select: { role: true } } },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.displayName,
        role: r.agent?.role ?? null,
        kind: (r.kind === 'agent' ? 'agent' : 'human') as MemberKind,
      },
    ]),
  );
}

/**
 * Agent members flattened to the shape the adapter-invoking routes use.
 * They need `name` and `role` on the row itself; Member keeps those in
 * `displayName` and the agent profile. One place does the flattening.
 */
export interface AgentRow {
  id: string;
  name: string;
  role: string;
  kind: 'independent' | 'personal_assistant';
  teamId: string | null;
  modelName: string;
  harnessName: string;
  tools: string[];
  permissions: string[];
  ownerMemberId: string | null;
  status: string;
}

function toAgentRow(r: {
  id: string; displayName: string; teamId: string | null; status: string;
  agent: { role: string; modelName: string; harnessName: string; tools: string; permissions: string; ownerMemberId: string | null } | null;
}): AgentRow {
  const a = r.agent;
  const parse = (s: string | undefined): string[] => {
    try { const v = JSON.parse(s ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  return {
    id: r.id,
    name: r.displayName,
    role: a?.role ?? 'agent',
    kind: a?.ownerMemberId ? 'personal_assistant' : 'independent',
    teamId: r.teamId,
    modelName: a?.modelName ?? 'harness/deterministic',
    harnessName: a?.harnessName ?? 'deterministic',
    tools: parse(a?.tools),
    permissions: parse(a?.permissions),
    ownerMemberId: a?.ownerMemberId ?? null,
    status: r.status,
  };
}

const AGENT_SELECT = {
  id: true, displayName: true, teamId: true, status: true,
  agent: { select: { role: true, modelName: true, harnessName: true, tools: true, permissions: true, ownerMemberId: true } },
} as const;

export async function listAgentRows(orgId: string): Promise<AgentRow[]> {
  const rows = await db.member.findMany({
    where: { orgId, kind: 'agent', status: 'active' },
    orderBy: [{ displayName: 'asc' }],
    select: AGENT_SELECT,
  });
  return rows.map((r) => toAgentRow(r as Parameters<typeof toAgentRow>[0]));
}

export async function getAgentRow(id: string): Promise<AgentRow | null> {
  const row = await db.member.findFirst({ where: { id, kind: 'agent' }, select: AGENT_SELECT });
  return row ? toAgentRow(row as Parameters<typeof toAgentRow>[0]) : null;
}

/** The active agent filling a role — how a handoff finds its expert. */
export async function findAgentByRole(orgId: string, role: string): Promise<AgentRow | null> {
  const row = await db.member.findFirst({
    where: { orgId, kind: 'agent', status: 'active', agent: { role } },
    select: AGENT_SELECT,
  });
  return row ? toAgentRow(row as Parameters<typeof toAgentRow>[0]) : null;
}
