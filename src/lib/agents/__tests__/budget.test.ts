// ADR-0007 describes a budget and nothing read one. Every run recorded what it
// cost and no code ever added them up before starting another, so an org left
// running overnight with a hosted model spends real money.

import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '@/lib/db';
import { dailyBudgetCents, DEFAULT_DAILY_BUDGET_CENTS, spendToday } from '@/lib/agents/budget';

const TENANT = 'tnt-budget';
const ORG = 'org-budget';
const MEMBER = 'mbr-budget';
const ITEM = 'wi-budget';

const saved = process.env.VUNO_DAILY_BUDGET_CENTS;

beforeAll(async () => {
  await db.tenant.create({ data: { id: TENANT, name: 'T', slug: 'budget-t' } });
  await db.organization.create({ data: { id: ORG, tenantId: TENANT, name: 'O', slug: 'budget-o' } });
  await db.member.create({
    data: {
      id: MEMBER, tenantId: TENANT, orgId: ORG, kind: 'agent', displayName: 'Peri', handle: 'budget-peri',
      agent: { create: { role: 'perf', modelName: 'claude-opus-5', harnessName: 'anthropic' } },
    },
  });
  await db.workItem.create({
    data: { id: ITEM, tenantId: TENANT, orgId: ORG, kind: 'agent_turn', subjectType: 'channel', subjectId: 'x' },
  });
});

afterEach(async () => {
  await db.workSession.deleteMany({ where: { orgId: ORG } });
  if (saved === undefined) delete process.env.VUNO_DAILY_BUDGET_CENTS;
  else process.env.VUNO_DAILY_BUDGET_CENTS = saved;
});

afterAll(async () => {
  await db.workItem.deleteMany({ where: { orgId: ORG } });
  await db.member.deleteMany({ where: { orgId: ORG } });
  await db.organization.deleteMany({ where: { id: ORG } });
  await db.tenant.deleteMany({ where: { id: TENANT } });
});

async function spent(cents: number, startedAt = new Date()) {
  await db.workSession.create({
    data: {
      tenantId: TENANT, orgId: ORG, workItemId: ITEM, memberId: MEMBER,
      outcome: 'succeeded', costCents: cents, startedAt,
    },
  });
}

describe('the ceiling', () => {
  test('an org that has spent nothing has its whole budget', async () => {
    process.env.VUNO_DAILY_BUDGET_CENTS = '500';
    const spend = await spendToday(ORG);
    expect(spend).toEqual({ spentCents: 0, budgetCents: 500, remainingCents: 500, exhausted: false });
  });

  test('runs are summed, and the ceiling is reached at it rather than past it', async () => {
    process.env.VUNO_DAILY_BUDGET_CENTS = '10';
    await spent(4);
    await spent(5);
    expect((await spendToday(ORG)).exhausted).toBe(false);

    await spent(1);
    const spend = await spendToday(ORG);
    expect(spend.spentCents).toBe(10);
    expect(spend.remainingCents).toBe(0);
    expect(spend.exhausted).toBe(true);
  });

  test('yesterday does not count against today — a day, not a running total', async () => {
    process.env.VUNO_DAILY_BUDGET_CENTS = '10';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await spent(500, yesterday);

    const spend = await spendToday(ORG);
    expect(spend.spentCents).toBe(0);
    expect(spend.exhausted).toBe(false);
  });

  test('zero means no ceiling, stated rather than assumed', async () => {
    process.env.VUNO_DAILY_BUDGET_CENTS = '0';
    await spent(100_000);
    const spend = await spendToday(ORG);
    expect(spend.remainingCents).toBeNull();
    expect(spend.exhausted).toBe(false);
  });

  test('an unset or unusable value falls back to the documented default', () => {
    delete process.env.VUNO_DAILY_BUDGET_CENTS;
    expect(dailyBudgetCents()).toBe(DEFAULT_DAILY_BUDGET_CENTS);

    process.env.VUNO_DAILY_BUDGET_CENTS = 'lots';
    expect(dailyBudgetCents()).toBe(DEFAULT_DAILY_BUDGET_CENTS);

    process.env.VUNO_DAILY_BUDGET_CENTS = '-5';
    expect(dailyBudgetCents()).toBe(DEFAULT_DAILY_BUDGET_CENTS);
  });
});

describe('a turn past the ceiling does not run', () => {
  test('it is refused before the model is called, and says how to raise it', async () => {
    process.env.VUNO_DAILY_BUDGET_CENTS = '1';
    await spent(5);

    let called = false;
    const server = Bun.serve({
      port: 0,
      fetch() {
        called = true;
        return Response.json({ content: [{ type: 'text', text: '{}' }] });
      },
    });
    const env = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`;

    try {
      const { runAgentTurn } = await import('@/lib/agents/turn');
      await expect(
        runAgentTurn({
          tenantId: TENANT, orgId: ORG, memberId: MEMBER,
          scopeType: 'channel', scopeId: 'ch-nowhere',
        }),
      ).rejects.toThrow(/VUNO_DAILY_BUDGET_CENTS/);

      // The point of checking before the call: a budget enforced on the way out
      // has already spent the money it was meant to stop.
      expect(called).toBe(false);
    } finally {
      server.stop(true);
      if (env.key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = env.key;
      if (env.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = env.base;
    }
  });
});
