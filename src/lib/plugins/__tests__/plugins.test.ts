// A plugin either installed or it did not.
//
// The two failure modes worth guarding are the ones nobody notices: a half
// install, where the org holds a capability that partly exists and no screen
// says which part; and an uninstall that takes something the plugin never
// brought, because it matched on a key rather than on what it created.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { installPlugin, listPlugins, PluginError, uninstallPlugin } from '@/lib/plugins';
import { parseManifest } from '@/lib/plugins/manifest';
import { catalogue } from '@/lib/plugins/catalogue';

const TENANT = 'tnt-plug';
const ORG = 'org-plug';
const base = { tenantId: TENANT, orgId: ORG } as const;

const MANIFEST = {
  key: 'demo-pack',
  name: 'Demo Pack',
  summary: 'A skill, a connector and the agent that uses both.',
  version: '1.0.0',
  author: 'Vuno',
  skills: [
    {
      key: 'demo-method',
      name: 'Demo method',
      summary: 'How this org does the thing.',
      content: 'State the target before you measure.',
    },
  ],
  connectors: [
    {
      key: 'demo-metrics',
      name: 'Demo Metrics',
      summary: 'Latency per service.',
      // Deliberately a port nothing is listening on: install must survive a
      // connector it cannot reach, and say so.
      url: 'http://127.0.0.1:4599/mcp',
      authEnvVar: null,
    },
  ],
  agents: [
    {
      handle: 'demobot',
      displayName: 'Demo Bot',
      roleLabel: 'Performance',
      harnessName: 'anthropic',
      modelName: 'claude-sonnet-4',
      skills: ['demo-method'],
      connectors: ['demo-metrics'],
    },
  ],
};

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'plug-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'plug-o' } });
});

afterEach(async () => {
  await db.memberSkill.deleteMany({ where: { orgId: ORG } });
  await db.memberConnection.deleteMany({ where: { orgId: ORG } });
  await db.skill.deleteMany({ where: { orgId: ORG } });
  await db.connection.deleteMany({ where: { orgId: ORG } });
  await db.plugin.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
  await db.agentProfile.deleteMany({ where: { member: { orgId: ORG } } });
  await db.member.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('the manifest', () => {
  test('refuses a package that installs nothing', () => {
    const r = parseManifest({ ...MANIFEST, skills: [], connectors: [], agents: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('at least one');
  });

  test('refuses an agent asking for a skill the plugin does not carry', () => {
    const r = parseManifest({
      ...MANIFEST,
      agents: [{ ...MANIFEST.agents[0], skills: ['not-in-here'] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('not-in-here');
  });

  test('names the field that is wrong, not just that something is', () => {
    const r = parseManifest({ ...MANIFEST, version: 'latest' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('version');
  });
});

describe('installing', () => {
  test('creates the skill, the connector and the agent, and wires them together', async () => {
    const result = await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });

    expect(result.skills).toBe(1);
    expect(result.connectors).toBe(1);
    expect(result.agents).toBe(1);

    const agent = await db.member.findFirstOrThrow({ where: { orgId: ORG, handle: 'demobot' } });
    const held = await db.memberSkill.count({ where: { memberId: agent.id } });
    const reach = await db.memberConnection.count({ where: { memberId: agent.id } });
    expect(held).toBe(1);
    expect(reach).toBe(1);
  });

  test('marks what it created, so an uninstall knows what is its', async () => {
    const { pluginId } = await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    const skill = await db.skill.findFirstOrThrow({ where: { orgId: ORG, key: 'demo-method' } });
    expect(skill.pluginId).toBe(pluginId);
    expect(skill.source).toBe('plugin');
  });

  test('installs a connector it cannot reach, and says which one', async () => {
    const result = await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    expect(result.unreachable).toEqual(['Demo Metrics']);

    // Installed, and honest about it: the row carries the reason.
    const conn = await db.connection.findFirstOrThrow({ where: { orgId: ORG, key: 'demo-metrics' } });
    expect(conn.lastError).not.toBeNull();
  });

  test('refuses to install twice, naming the version already here', async () => {
    await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    const again = installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    await expect(again).rejects.toThrow(/already installed/);
  });

  test('refuses when a skill key is already taken, rather than adopting it', async () => {
    await db.skill.create({
      data: { ...base, key: 'demo-method', name: 'Written by hand', summary: 'Mine', content: 'Mine.' },
    });
    const install = installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    await expect(install).rejects.toThrow(/Written by hand/);

    // And nothing was left behind by the attempt.
    expect(await db.plugin.count({ where: { orgId: ORG } })).toBe(0);
    expect(await db.connection.count({ where: { orgId: ORG } })).toBe(0);
  });

  test('a manifest that does not parse installs nothing', async () => {
    const install = installPlugin({ ...base, manifest: { key: 'x' }, source: 'added' });
    await expect(install).rejects.toThrow(PluginError);
    expect(await db.plugin.count({ where: { orgId: ORG } })).toBe(0);
  });
});

describe('uninstalling', () => {
  test('takes back what it created', async () => {
    const { pluginId } = await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    await uninstallPlugin(ORG, pluginId);

    expect(await db.skill.count({ where: { orgId: ORG } })).toBe(0);
    expect(await db.connection.count({ where: { orgId: ORG } })).toBe(0);
    expect(await db.plugin.count({ where: { orgId: ORG } })).toBe(0);
  });

  test('leaves a skill somebody wrote by hand alone, even under the same key', async () => {
    const { pluginId } = await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    const mine = await db.skill.create({
      data: { ...base, key: 'mine-alone', name: 'Mine', summary: 'Written here', content: 'Mine.' },
    });

    await uninstallPlugin(ORG, pluginId);
    expect(await db.skill.findUnique({ where: { id: mine.id } })).not.toBeNull();
  });

  test('does not retire the agent it hired, and names them', async () => {
    const { pluginId } = await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });
    const { agents } = await uninstallPlugin(ORG, pluginId);

    expect(agents).toEqual(['demobot']);
    const still = await db.member.findFirst({ where: { orgId: ORG, handle: 'demobot' } });
    expect(still?.status).toBe('active');
  });

  test('refuses a plugin that is not installed here', async () => {
    await expect(uninstallPlugin(ORG, 'nope')).rejects.toThrow(/not installed/);
  });
});

describe('the row', () => {
  test('reports what is actually there, not what the manifest claimed', async () => {
    await installPlugin({ ...base, manifest: MANIFEST, source: 'added' });

    // Somebody retires the agent afterwards. The plugin still declares one.
    await db.member.updateMany({ where: { orgId: ORG, handle: 'demobot' }, data: { status: 'retired' } });

    const [row] = await listPlugins(ORG);
    expect(row.declares.agents).toBe(1);
    expect(row.installed.agents).toBe(0);
    expect(row.installed.skills).toBe(1);
  });
});

describe('the bundled catalogue', () => {
  test('every manifest that ships parses', async () => {
    const { entries, broken } = await catalogue();
    expect(broken).toEqual([]);
    expect(entries.length).toBeGreaterThan(0);
  });

  test('every catalogue plugin installs into a real org', async () => {
    const { entries } = await catalogue();
    for (const { manifest } of entries) {
      const result = await installPlugin({ ...base, manifest, source: 'catalogue' });
      expect(result.skills).toBe(manifest.skills.length);
      expect(result.agents).toBe(manifest.agents.length);
    }
  });
});
