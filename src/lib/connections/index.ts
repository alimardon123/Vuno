// Vuno — connections in the Library.
//
// A connection sits beside a skill because both answer "what is this member
// made of": a skill is what they know, a connection is what they can reach.
// Holding one is the permission to call it. There is no second permission list
// to keep in step with this one, which is the failure mode a separate list
// always has — the row says who may call it, and that is the only place to
// look.
//
// This deliberately arrived after `client.ts` and not before it. A row
// declaring a connection nothing can call describes a capability the org does
// not have, which is exactly the scripted-theatre failure that was removed from
// this codebase (docs/REVIEW-2026-08-23.md).

import { db } from '@/lib/db';
import { ConnectionError as DialError, discoverTools, type DiscoveredTool } from '@/lib/connections/client';

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export interface ConnectionRow {
  id: string;
  key: string;
  name: string;
  summary: string;
  url: string;
  authEnvVar: string | null;
  /** What was discovered last time anything connected. Empty until checked. */
  tools: DiscoveredTool[];
  checkedAt: string | null;
  lastError: string | null;
  holders: Array<{ id: string; displayName: string; kind: string }>;
}

function parseTools(raw: string | null): DiscoveredTool[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DiscoveredTool[]) : [];
  } catch {
    return [];
  }
}

export async function listConnections(orgId: string): Promise<ConnectionRow[]> {
  const rows = await db.connection.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
    include: {
      holders: { select: { member: { select: { id: true, displayName: true, kind: true, status: true } } } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    summary: c.summary,
    url: c.url,
    authEnvVar: c.authEnvVar,
    tools: parseTools(c.toolsCache),
    checkedAt: c.checkedAt ? String(c.checkedAt) : null,
    lastError: c.lastError,
    // A retired member keeps the row; the Library shows who is actually using it.
    holders: c.holders
      .map((h) => h.member)
      .filter((m) => m.status === 'active')
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  }));
}

const KEY = /^[a-z0-9][a-z0-9-]{1,60}$/;
const ENV_VAR = /^[A-Z][A-Z0-9_]{1,63}$/;

export async function createConnection(input: {
  tenantId: string;
  orgId: string;
  key: string;
  name: string;
  summary: string;
  url: string;
  authEnvVar?: string | null;
  /** Set when a plugin installed this, so uninstalling it takes this back. */
  pluginId?: string | null;
}): Promise<{ id: string }> {
  const key = input.key.trim().toLowerCase();
  if (!KEY.test(key)) {
    throw new ConnectionError(
      `"${input.key}" is not a usable key. Lowercase letters, digits and dashes — an agent package refers to a connection by this.`,
    );
  }

  const url = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConnectionError(`"${url}" is not a URL. An MCP endpoint looks like https://example.com/mcp.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConnectionError(`"${url}" is not an http or https address, so nothing here can dial it.`);
  }

  const authEnvVar = input.authEnvVar?.trim() || null;
  if (authEnvVar) {
    if (!ENV_VAR.test(authEnvVar)) {
      throw new ConnectionError(
        `"${authEnvVar}" is not an environment variable name. Use capitals, digits and underscores, e.g. OBSERVABILITY_MCP_TOKEN.`,
      );
    }
    // The name is configuration; the value is a secret. Somebody pasting the
    // token into this field would put it in the database, the backup and the
    // JSON export at once, so refuse the shape rather than store it.
    if (authEnvVar.length > 64 || /^(sk|pat|ghp|xox)[-_]/i.test(input.authEnvVar ?? '')) {
      throw new ConnectionError(
        'That looks like the token itself rather than the name of a variable holding it. ' +
          'Put the token in .env and name the variable here — it is never stored in the org.',
      );
    }
  }

  const taken = await db.connection.findFirst({ where: { orgId: input.orgId, key }, select: { name: true } });
  if (taken) throw new ConnectionError(`The key "${key}" already belongs to "${taken.name}".`);

  return db.connection.create({
    data: {
      tenantId: input.tenantId,
      orgId: input.orgId,
      key,
      name: input.name.trim(),
      summary: input.summary.trim(),
      url,
      authEnvVar,
      pluginId: input.pluginId ?? null,
    },
    select: { id: true },
  });
}

/**
 * Dial the server and record what it offers.
 *
 * The result is stored so the Library can render tools without a round trip on
 * every page load, and so a connection that has never worked says so on the row
 * rather than only when an agent tries to use it at 3am.
 */
export async function checkConnection(orgId: string, connectionId: string): Promise<ConnectionRow> {
  const row = await db.connection.findFirst({ where: { id: connectionId, orgId } });
  if (!row) throw new ConnectionError('That connection is not in this org.', 404);

  try {
    const tools = await discoverTools(row);
    await db.connection.update({
      where: { id: row.id },
      data: { toolsCache: JSON.stringify(tools), checkedAt: new Date(), lastError: null },
    });
  } catch (e) {
    const said = e instanceof DialError ? e.message : e instanceof Error ? e.message : String(e);
    await db.connection.update({
      where: { id: row.id },
      data: { checkedAt: new Date(), lastError: said },
    });
  }

  const all = await listConnections(orgId);
  return all.find((c) => c.id === connectionId)!;
}

/** Give a connection to a member, or take it back. Idempotent in both directions. */
export async function setConnectionHolder(input: {
  orgId: string;
  connectionId: string;
  memberId: string;
  held: boolean;
}): Promise<void> {
  const [conn, member] = await Promise.all([
    db.connection.findFirst({
      where: { id: input.connectionId, orgId: input.orgId },
      select: { id: true, tenantId: true, name: true, lastError: true, checkedAt: true },
    }),
    db.member.findFirst({
      where: { id: input.memberId, orgId: input.orgId },
      select: { id: true, displayName: true, status: true },
    }),
  ]);
  if (!conn) throw new ConnectionError('That connection is not in this org.', 404);
  if (!member) throw new ConnectionError('That member is not in this org.', 404);
  if (input.held && member.status !== 'active') {
    throw new ConnectionError(`${member.displayName} has been retired and cannot take on new work.`);
  }
  if (input.held && conn.lastError) {
    throw new ConnectionError(
      `${conn.name} is not reachable, so giving it to ${member.displayName} would hand them a capability that does not work. ` +
        `Fix it and check it again first — the last attempt said: ${conn.lastError}`,
    );
  }

  if (input.held) {
    await db.memberConnection.upsert({
      where: { memberId_connectionId: { memberId: member.id, connectionId: conn.id } },
      create: { tenantId: conn.tenantId, orgId: input.orgId, memberId: member.id, connectionId: conn.id },
      update: {},
    });
  } else {
    await db.memberConnection.deleteMany({ where: { memberId: member.id, connectionId: conn.id } });
  }
}

export async function deleteConnection(orgId: string, connectionId: string): Promise<void> {
  const conn = await db.connection.findFirst({
    where: { id: connectionId, orgId },
    select: { id: true, name: true, _count: { select: { holders: true } } },
  });
  if (!conn) throw new ConnectionError('That connection is not in this org.', 404);
  if (conn._count.holders > 0) {
    throw new ConnectionError(
      `${conn.name} is held by ${conn._count.holders} member${conn._count.holders === 1 ? '' : 's'}. ` +
        'Take it back from them first — removing it silently would change what they can do.',
    );
  }
  await db.connection.delete({ where: { id: connectionId } });
}

/** What one member may call, with everything needed to dial it. */
export async function connectionsHeldBy(memberId: string) {
  const held = await db.memberConnection.findMany({
    where: { memberId },
    select: {
      connection: { select: { id: true, key: true, name: true, url: true, authEnvVar: true, toolsCache: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return held.map((h) => ({ ...h.connection, tools: parseTools(h.connection.toolsCache) }));
}
