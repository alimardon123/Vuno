// Vuno — installing and removing plugins.
//
// A plugin is the unit that makes the other two useful. A skill on its own is
// text nobody holds; a connector on its own is a server nobody may call. What a
// person actually wants is "give this org the ability to run benchmarks the way
// we run them", and that is a skill, the connector it reads from, and the agent
// hired to do it — installed together and wired to each other.
//
// Two rules the rest of this file exists to keep:
//
//   1. Installing is all-or-nothing. A plugin that created two skills and then
//      failed on the third leaves an org holding a capability that half exists,
//      and nothing on the screen says which half.
//   2. Uninstalling removes what this plugin created and nothing else. The
//      manifest is stored verbatim for that reason — matching on keys would
//      take a skill someone wrote by hand that happens to share a name.

import { db } from '@/lib/db';
import { createSkill, setSkillHolder } from '@/lib/skills';
import { createConnection, setConnectionHolder, checkConnection } from '@/lib/connections';
import { hireMember, RosterError } from '@/lib/members/roster';
import { parseManifest, type Manifest } from '@/lib/plugins/manifest';

export class PluginError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

export interface PluginRow {
  id: string;
  key: string;
  name: string;
  summary: string;
  version: string;
  author: string | null;
  source: string;
  installedAt: string;
  /** What it put in this org, counted from what is actually there now. */
  installed: { skills: number; connectors: number; agents: number };
  /** What the manifest says it carries, for the row to describe itself. */
  declares: { skills: number; connectors: number; agents: number };
}

/** The handles a plugin's manifest asks to hire. Kept out of the DB shape. */
function agentHandles(manifest: Manifest): string[] {
  return manifest.agents.map((a) => a.handle);
}

export async function listPlugins(orgId: string): Promise<PluginRow[]> {
  const rows = await db.plugin.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { skills: true, connections: true } },
    },
  });

  return Promise.all(
    rows.map(async (p) => {
      const manifest = readStored(p.manifest);
      const handles = manifest ? agentHandles(manifest) : [];
      // Counted rather than assumed: an agent this plugin hired can be retired
      // from the roster afterwards, and the row should say so.
      const agents =
        handles.length === 0
          ? 0
          : await db.member.count({ where: { orgId, handle: { in: handles }, status: 'active' } });

      return {
        id: p.id,
        key: p.key,
        name: p.name,
        summary: p.summary,
        version: p.version,
        author: p.author,
        source: p.source,
        installedAt: p.installedAt.toISOString(),
        installed: { skills: p._count.skills, connectors: p._count.connections, agents },
        declares: {
          skills: manifest?.skills.length ?? 0,
          connectors: manifest?.connectors.length ?? 0,
          agents: handles.length,
        },
      };
    }),
  );
}

/** A stored manifest that no longer parses is a bug, not a crash. */
function readStored(raw: string): Manifest | null {
  try {
    const parsed = parseManifest(JSON.parse(raw) as unknown);
    return parsed.ok ? parsed.manifest : null;
  } catch {
    return null;
  }
}

export interface InstallResult {
  pluginId: string;
  skills: number;
  connectors: number;
  agents: number;
  /** Connectors that were added but could not be reached, by name. */
  unreachable: string[];
}

/**
 * Install a plugin into an org.
 *
 * The whole thing runs inside one transaction so rule 1 holds. Reaching each
 * connector deliberately happens *after* it commits: dialling a server takes
 * seconds and holding a SQLite write transaction open across a network call is
 * how one slow server stops every other write in the org. A connector that
 * cannot be reached is installed and says so — that is a true statement about
 * the org, and refusing the install would make a laptop offline on a train
 * unable to add a plugin it will use tomorrow.
 */
export async function installPlugin(input: {
  tenantId: string;
  orgId: string;
  manifest: unknown;
  source: 'catalogue' | 'added';
}): Promise<InstallResult> {
  const parsed = parseManifest(input.manifest);
  if (!parsed.ok) throw new PluginError(parsed.error);
  const manifest = parsed.manifest;

  const existing = await db.plugin.findFirst({
    where: { orgId: input.orgId, key: manifest.key },
    select: { name: true, version: true },
  });
  if (existing) {
    throw new PluginError(
      `${existing.name} ${existing.version} is already installed. Remove it first — installing over it would leave whatever the two versions disagree about.`,
      409,
    );
  }

  // Anything a plugin brings that the org already has by that key is a
  // collision worth stopping on, because taking the plugin back out later
  // would otherwise delete something that was here first.
  const [skillClash, connClash] = await Promise.all([
    db.skill.findFirst({
      where: { orgId: input.orgId, key: { in: manifest.skills.map((s) => s.key) } },
      select: { key: true, name: true },
    }),
    db.connection.findFirst({
      where: { orgId: input.orgId, key: { in: manifest.connectors.map((c) => c.key) } },
      select: { key: true, name: true },
    }),
  ]);
  if (skillClash) {
    throw new PluginError(
      `This plugin carries a skill keyed "${skillClash.key}", and "${skillClash.name}" already has that key. Rename or remove that one first.`,
      409,
    );
  }
  if (connClash) {
    throw new PluginError(
      `This plugin carries a connector keyed "${connClash.key}", and "${connClash.name}" already has that key. Rename or remove that one first.`,
      409,
    );
  }

  const created = await db.$transaction(async (tx) => {
    const plugin = await tx.plugin.create({
      data: {
        tenantId: input.tenantId,
        orgId: input.orgId,
        key: manifest.key,
        name: manifest.name,
        summary: manifest.summary,
        version: manifest.version,
        author: manifest.author ?? null,
        source: input.source,
        manifest: JSON.stringify(manifest),
      },
      select: { id: true },
    });

    const skillIds = new Map<string, string>();
    for (const s of manifest.skills) {
      const row = await tx.skill.create({
        data: {
          tenantId: input.tenantId,
          orgId: input.orgId,
          key: s.key,
          name: s.name,
          summary: s.summary,
          content: s.content,
          source: 'plugin',
          pluginId: plugin.id,
        },
        select: { id: true },
      });
      skillIds.set(s.key, row.id);
    }

    const connectorIds = new Map<string, string>();
    for (const c of manifest.connectors) {
      const row = await tx.connection.create({
        data: {
          tenantId: input.tenantId,
          orgId: input.orgId,
          key: c.key,
          name: c.name,
          summary: c.summary,
          url: c.url,
          authEnvVar: c.authEnvVar ?? null,
          pluginId: plugin.id,
        },
        select: { id: true },
      });
      connectorIds.set(c.key, row.id);
    }

    return { pluginId: plugin.id, skillIds, connectorIds };
  });

  // Agents are hired outside the transaction because `hireMember` writes to the
  // event spine, and the spine has one writer that is not this transaction
  // (ADR-0008). A handle already taken fails this one agent by name rather than
  // the whole install — the skills and connectors are already in and useful.
  const hired: string[] = [];
  const refused: string[] = [];
  for (const a of manifest.agents) {
    try {
      const member = await hireMember({
        tenantId: input.tenantId,
        orgId: input.orgId,
        kind: 'agent',
        handle: a.handle,
        displayName: a.displayName,
        role: a.roleLabel ?? undefined,
        harnessName: a.harnessName,
        modelName: a.modelName,
      });
      hired.push(a.handle);

      for (const key of a.skills) {
        const skillId = created.skillIds.get(key);
        if (skillId) await setSkillHolder({ orgId: input.orgId, skillId, memberId: member.id, held: true });
      }
      for (const key of a.connectors) {
        const connectionId = created.connectorIds.get(key);
        if (connectionId) {
          await setConnectionHolder({ orgId: input.orgId, connectionId, memberId: member.id, held: true });
        }
      }
    } catch (e) {
      refused.push(`@${a.handle}: ${e instanceof RosterError ? e.message : 'could not be hired'}`);
    }
  }

  // Now dial each connector, so the row says whether it works rather than
  // implying it does. A failure here is recorded on the row, not thrown.
  const unreachable: string[] = [];
  for (const [key, id] of created.connectorIds) {
    const row = await checkConnection(input.orgId, id).catch(() => null);
    if (!row || row.lastError) unreachable.push(row?.name ?? key);
  }

  if (refused.length > 0) {
    throw new PluginError(
      `${manifest.name} installed, but ${refused.length === 1 ? 'one agent' : `${refused.length} agents`} could not be hired — ${refused.join('; ')}. Everything else is in place.`,
      207,
    );
  }

  return {
    pluginId: created.pluginId,
    skills: created.skillIds.size,
    connectors: created.connectorIds.size,
    agents: hired.length,
    unreachable,
  };
}

/**
 * Take a plugin back out.
 *
 * Skills and connectors go with it — they were created by it, and the cascade
 * on `MemberSkill` / `MemberConnection` takes the holdings with them. Agents do
 * not: hiring one is an event on the spine and a member who has been working
 * for a fortnight is not an implementation detail of a package. They are named
 * in the result so the caller can retire them deliberately.
 */
export async function uninstallPlugin(orgId: string, pluginId: string): Promise<{ name: string; agents: string[] }> {
  const plugin = await db.plugin.findFirst({
    where: { id: pluginId, orgId },
    select: { id: true, name: true, manifest: true },
  });
  if (!plugin) throw new PluginError('That plugin is not installed here.', 404);

  const manifest = readStored(plugin.manifest);
  const handles = manifest ? agentHandles(manifest) : [];
  const stillHere =
    handles.length === 0
      ? []
      : await db.member.findMany({
          where: { orgId, handle: { in: handles }, status: 'active' },
          select: { handle: true },
        });

  // One statement each, scoped by pluginId — never by key. Deleting the plugin
  // row alone would `SetNull` these and leave them behind, unowned.
  await db.$transaction([
    db.skill.deleteMany({ where: { orgId, pluginId } }),
    db.connection.deleteMany({ where: { orgId, pluginId } }),
    db.plugin.delete({ where: { id: pluginId } }),
  ]);

  return { name: plugin.name, agents: stillHere.map((m) => m.handle) };
}
