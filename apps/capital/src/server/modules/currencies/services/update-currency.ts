import type { DbClient } from "@capital/server/lib/prisma";
import { updateCurrencyRate } from "../data/commands/update-currency-rate";
import { fetchCurrencyByCode } from "../data/queries/fetch-currencies";

export async function updateCurrencyRateService(
  userId: string,
  code: string,
  manualRate: number,
  db: DbClient
) {
  const existing = await fetchCurrencyByCode(userId, code, db);
  if (!existing) {
    throw new Error("Currency not found");
  }

  return updateCurrencyRate(userId, code, manualRate, db);
}
