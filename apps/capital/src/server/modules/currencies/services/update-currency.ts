import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
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
    throw new LedgerError("Currency not found", 404, { code: "currency.not_found" });
  }

  return updateCurrencyRate(userId, code, manualRate, db);
}
