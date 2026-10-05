import type { DbClient } from "@capital/server/lib/prisma";

/** A rate the user typed: labelled manual, so the automatic refresh leaves it alone. */
export async function updateCurrencyRate(userId: string, code: string, manualRate: number, db: DbClient, now: Date = new Date()) {
  return db.currency.update({
    where: { userId_code: { userId, code } },
    data: { manualRate, source: "manual", rateUpdatedAt: now },
  });
}
