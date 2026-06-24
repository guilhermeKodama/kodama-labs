import type { DbClient } from "@capital/server/lib/prisma";

export interface SnapshotData {
  snapshotDate: Date;
  currentInvested: number;
  currentMonthlyExpenses: number;
  fireNumber: number;
  progress: number;
  monthsToFire: number | null;
  projectedFireDate: Date | null;
}

/**
 * Record (or refresh) the snapshot for a goal + period. Idempotent per month via
 * the (goalId, period) unique key: when `force` is false an existing row is left
 * untouched (lazy capture on first visit of the month); when true it is updated.
 */
export async function recordFireSnapshot(
  goalId: string,
  period: number,
  data: SnapshotData,
  force: boolean,
  db: DbClient
) {
  return db.fireSnapshot.upsert({
    where: { goalId_period: { goalId, period } },
    create: { goalId, period, ...data },
    update: force ? data : {},
  });
}
