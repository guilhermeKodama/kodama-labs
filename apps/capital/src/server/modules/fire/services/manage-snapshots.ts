import type { DbClient } from "@capital/server/lib/prisma";
import { computeFireNumber } from "@/lib/fire";

import type { SnapshotUpsertInput } from "../validations/fire";
import { fetchFireGoal } from "../data/queries/fetch-fire-goal";
import { recordFireSnapshot } from "../data/commands/record-fire-snapshot";

/**
 * Create or edit the snapshot for a specific month (manual entry / backfill).
 * The user supplies the invested amount; progress is derived from the current plan.
 */
export async function upsertManualSnapshot(
  userId: string,
  period: number,
  input: SnapshotUpsertInput,
  db: DbClient
) {
  const goal = await fetchFireGoal(userId, db);
  if (!goal) return null;

  const fireNumber = computeFireNumber(goal.targetMonthlyIncome * 12, goal.safeWithdrawalRate);
  const year = Math.floor(period / 100);
  const month = period % 100;
  const snapshotDate = new Date(Date.UTC(year, month - 1, 1, 12));

  return recordFireSnapshot(
    goal.id,
    period,
    {
      snapshotDate,
      currentInvested: input.currentInvested,
      currentMonthlyExpenses: input.currentMonthlyExpenses ?? 0,
      fireNumber,
      progress: fireNumber > 0 ? input.currentInvested / fireNumber : 0,
      monthsToFire: null,
      projectedFireDate: null,
    },
    true,
    db
  );
}

export async function deleteSnapshot(userId: string, period: number, db: DbClient): Promise<boolean> {
  const goal = await fetchFireGoal(userId, db);
  if (!goal) return false;
  await db.fireSnapshot.deleteMany({ where: { goalId: goal.id, period } });
  return true;
}
