import type { DbClient } from "@capital/server/lib/prisma";
import { deleteCurrency as deleteCurrencyCmd } from "../data/commands/delete-currency";
import { fetchCurrencyByCode } from "../data/queries/fetch-currencies";

export async function deleteCurrencyService(
  userId: string,
  code: string,
  db: DbClient
) {
  const existing = await fetchCurrencyByCode(userId, code, db);
  if (!existing) {
    throw new Error("Currency not found");
  }

  return deleteCurrencyCmd(userId, code, db);
}
