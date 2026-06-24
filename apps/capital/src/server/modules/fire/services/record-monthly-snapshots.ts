import type { DbClient } from "@capital/server/lib/prisma";
import { computeCurrentInvested, computeCurrentMonthlyExpenses } from "@/lib/fire/adapter";
import { computeFireNumber } from "@/lib/fire";

import { TRAILING_MONTHS } from "../constants";
import { fetchFireInputs } from "../data/queries/fetch-fire-inputs";
import { recordFireSnapshot } from "../data/commands/record-fire-snapshot";

/**
 * Record a snapshot for the given period for EVERY user with a FIRE plan — used
 * by the monthly cron so progress accrues automatically, no manual clicking.
 */
export async function recordMonthlySnapshots(
  db: DbClient,
  opts: { period: number; snapshotDate: Date }
): Promise<{ recorded: number; total: number }> {
  const goals = await db.fireGoal.findMany({
    select: {
      id: true,
      userId: true,
      targetMonthlyIncome: true,
      safeWithdrawalRate: true,
      includeBusinessInvestments: true,
    },
  });

  let recorded = 0;
  for (const goal of goals) {
    try {
      const inputs = await fetchFireInputs(goal.userId, db, { trailingMonths: TRAILING_MONTHS });
      const holdings = inputs.holdings.filter(
        (h) => goal.includeBusinessInvestments || h.entityType === "personal"
      );
      const accounts = inputs.accounts.filter(
        (a) => goal.includeBusinessInvestments || a.entityType === "personal"
      );
      const currentInvested = computeCurrentInvested(holdings, accounts, inputs.currencyRates);
      const currentMonthlyExpenses = computeCurrentMonthlyExpenses(inputs.expenses, {
        months: TRAILING_MONTHS,
      });
      const fireNumber = computeFireNumber(goal.targetMonthlyIncome * 12, goal.safeWithdrawalRate);

      await recordFireSnapshot(
        goal.id,
        opts.period,
        {
          snapshotDate: opts.snapshotDate,
          currentInvested,
          currentMonthlyExpenses,
          fireNumber,
          progress: fireNumber > 0 ? currentInvested / fireNumber : 0,
          monthsToFire: null,
          projectedFireDate: null,
        },
        true,
        db
      );
      recorded++;
    } catch (err) {
      console.error(`[FireSnapshot] failed for goal ${goal.id}:`, err);
    }
  }

  return { recorded, total: goals.length };
}
