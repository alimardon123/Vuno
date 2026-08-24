// Vuno — what the organisation is allowed to spend.
//
// ADR-0007 describes a budget and nothing read one: every run recorded
// `costCents` and no code ever added them up before starting another. An org
// left running overnight with a hosted model spends real money, and the first
// thing anyone would want is a ceiling.
//
// A day, not a month: a runaway loop empties a monthly budget before anyone
// looks, and a daily one caps the damage at a day's worth.

import { db } from '@/lib/db';

/** Cents per day. Zero means no ceiling — stated, not assumed. */
export const DEFAULT_DAILY_BUDGET_CENTS = 500;

export function dailyBudgetCents(): number {
  const raw = process.env.VUNO_DAILY_BUDGET_CENTS?.trim();
  if (raw === undefined || raw === '') return DEFAULT_DAILY_BUDGET_CENTS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_DAILY_BUDGET_CENTS;
}

export interface Spend {
  spentCents: number;
  budgetCents: number;
  /** Null when there is no ceiling. */
  remainingCents: number | null;
  exhausted: boolean;
}

export async function spendToday(orgId: string, now = new Date()): Promise<Spend> {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  const { _sum } = await db.workSession.aggregate({
    where: { orgId, startedAt: { gte: midnight } },
    _sum: { costCents: true },
  });

  const spentCents = _sum.costCents ?? 0;
  const budgetCents = dailyBudgetCents();
  if (budgetCents === 0) {
    return { spentCents, budgetCents, remainingCents: null, exhausted: false };
  }
  return {
    spentCents,
    budgetCents,
    remainingCents: Math.max(budgetCents - spentCents, 0),
    exhausted: spentCents >= budgetCents,
  };
}

export class BudgetExhausted extends Error {
  constructor(spend: Spend) {
    super(
      `The org has spent ${money(spend.spentCents)} today against a ${money(spend.budgetCents)} budget, ` +
        'so agents have stopped running. Raise VUNO_DAILY_BUDGET_CENTS in .env, or set it to 0 for no ceiling.',
    );
    this.name = 'BudgetExhausted';
  }
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
