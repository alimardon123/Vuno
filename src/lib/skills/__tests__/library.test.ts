// A skill an agent holds and is never told about is a row in a table.
//
// The test that matters is the last one: what the Library shows is what reaches
// the model. Everything else here guards the refusals — a library that silently
// removes a skill three agents depend on changes how they work without saying so.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { createSkill, deleteSkill, listSkills, setSkillHolder, SkillError } from '@/lib/skills';

const TENANT = 'tnt-skill';
const ORG = 'org-skill';
const PERI = 'mbr-skill-peri';
const MIRA = 'mbr-skill-mira';
const GONE = 'mbr-skill-gone';

const base = { tenantId: TENANT, orgId: ORG };
const METHOD = {
  key: 'benchmark-methodology',
  name: 'Benchmark methodology',
  summary: 'How to run a measurement this org will accept.',
  content: 'State the target before you measure. Report the percentile the target names.',
};

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'skill-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'skill-o' } });
  await db.member.create({
    data: {
      id: PERI, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Peri', handle: 'skill-peri',
      agent: { create: { role: 'perf', modelName: 'claude-sonnet-4', harnessName: 'anthropic' } },
    },
  });
  await db.member.create({
    data: {
      id: MIRA, tenantId: TENANT, orgId: ORG, kind: 'human', displayName: 'Mira', handle: 'skill-mira',
      human: { create: { email: 'mira@skill.test' } },
    },
  });
  await db.member.create({
    data: {
      id: GONE, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Gone', handle: 'skill-gone',
      status: 'retired',
      agent: { create: { role: 'perf', modelName: 'm', harnessName: 'anthropic' } },
    },
  });
});

afterEach(async () => {
  await db.memberSkill.deleteMany({ where: { orgId: ORG } });
  await db.skill.deleteMany({ where: { orgId: ORG } });
  await db.event.deleteMany({ where: { orgId: ORG } });
});

afterAll(async () => {
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

describe('the library holds instructions, not settings', () => {
  test('a skill keeps its content verbatim — what is shown is what is told', async () => {
    await createSkill({ ...base, ...METHOD });
    const [skill] = await listSkills(ORG);
    expect(skill.content).toBe(METHOD.content);
    expect(skill.key).toBe('benchmark-methodology');
    expect(skill.version).toBe('1.0.0');
  });

  test('a skill with no instructions is refused — it would change nothing', async () => {
    await expect(createSkill({ ...base, ...METHOD, content: '   ' })).rejects.toThrow(/changes nothing/);
  });

  test('a key an agent package could not refer to is refused', async () => {
    await expect(createSkill({ ...base, ...METHOD, key: 'Not A Key!' })).rejects.toThrow(/agent package refers/);
  });

  test('a duplicate key names what already has it', async () => {
    await createSkill({ ...base, ...METHOD });
    await expect(createSkill({ ...base, ...METHOD, name: 'Something else' }))
      .rejects.toThrow(/already belongs to "Benchmark methodology"/);
  });
});

describe('holding a skill', () => {
  async function aSkill() {
    const { id } = await createSkill({ ...base, ...METHOD });
    return id;
  }

  test('giving and taking back are both idempotent', async () => {
    const skillId = await aSkill();
    await setSkillHolder({ orgId: ORG, skillId, memberId: PERI, held: true });
    await setSkillHolder({ orgId: ORG, skillId, memberId: PERI, held: true });
    expect(await db.memberSkill.count({ where: { skillId } })).toBe(1);

    await setSkillHolder({ orgId: ORG, skillId, memberId: PERI, held: false });
    await setSkillHolder({ orgId: ORG, skillId, memberId: PERI, held: false });
    expect(await db.memberSkill.count({ where: { skillId } })).toBe(0);
  });

  test('a person can hold one too — it is a shared reference (ADR-0009)', async () => {
    const skillId = await aSkill();
    await setSkillHolder({ orgId: ORG, skillId, memberId: MIRA, held: true });
    const [skill] = await listSkills(ORG);
    expect(skill.holders.map((h) => h.id)).toEqual([MIRA]);
  });

  test('a retired member cannot be given new work', async () => {
    const skillId = await aSkill();
    await expect(setSkillHolder({ orgId: ORG, skillId, memberId: GONE, held: true }))
      .rejects.toThrow(/retired/);
  });

  test('a retired holder does not show as using it', async () => {
    const skillId = await aSkill();
    await db.memberSkill.create({ data: { tenantId: TENANT, orgId: ORG, memberId: GONE, skillId } });
    const [skill] = await listSkills(ORG);
    expect(skill.holders).toEqual([]);
  });

  test('a member from another org is refused', async () => {
    const skillId = await aSkill();
    await expect(setSkillHolder({ orgId: ORG, skillId, memberId: 'mbr-elsewhere', held: true }))
      .rejects.toThrow(SkillError);
  });

  test('a skill somebody depends on cannot be deleted silently', async () => {
    const skillId = await aSkill();
    await setSkillHolder({ orgId: ORG, skillId, memberId: PERI, held: true });

    await expect(deleteSkill(ORG, skillId)).rejects.toThrow(/held by 1 member/);
    expect(await db.skill.count({ where: { orgId: ORG } })).toBe(1);

    await setSkillHolder({ orgId: ORG, skillId, memberId: PERI, held: false });
    await deleteSkill(ORG, skillId);
    expect(await db.skill.count({ where: { orgId: ORG } })).toBe(0);
  });
});

describe('a held skill reaches the model', () => {
  // The whole point. Without this the Library is a table nothing reads.
  test('the instructions are in the system prompt of the turn the agent takes', async () => {
    const { id: skillId } = await createSkill({ ...base, ...METHOD });
    await setSkillHolder({ orgId: ORG, skillId, memberId: PERI, held: true });

    await db.channel.create({
      data: { id: 'ch-skill', tenantId: TENANT, orgId: ORG, kind: 'channel', name: 'skill', slug: 'skill-ch' },
    });

    let system = '';
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        system = String(((await req.json()) as { system?: string }).system ?? '');
        return Response.json({
          content: [{ type: 'text', text: JSON.stringify({ events: [], claims: [] }) }],
          usage: { input_tokens: 10, output_tokens: 1 },
          model: 'claude-sonnet-4',
        });
      },
    });
    const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`;

    try {
      const { runAgentTurn } = await import('@/lib/agents/turn');
      await runAgentTurn({
        tenantId: TENANT, orgId: ORG, memberId: PERI,
        scopeType: 'channel', scopeId: 'ch-skill', reason: 'asked about the benchmark',
      });

      expect(system).toContain('Benchmark methodology');
      expect(system).toContain('State the target before you measure');
      expect(system).toContain('What you have been trained on');
    } finally {
      server.stop(true);
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = saved.base;
      await db.channel.deleteMany({ where: { orgId: ORG } });
    }
  });

  test('an agent that holds nothing is told nothing extra', async () => {
    const { systemPrompt } = await import('@/lib/agents/prompt');
    const manifest = {
      id: PERI, role: 'perf', kind: 'independent' as const,
      modelName: 'm', harnessName: 'anthropic', tools: [], permissions: [],
    };
    expect(systemPrompt(manifest, [])).not.toContain('What you have been trained on');
  });
});
