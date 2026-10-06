import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { deleteCurrency as deleteCurrencyCmd } from "../data/commands/delete-currency";
import { fetchCurrencyByCode } from "../data/queries/fetch-currencies";

export async function deleteCurrencyService(
  userId: string,
  code: string,
  db: DbClient
) {
  const existing = await fetchCurrencyByCode(userId, code, db);
  if (!existing) {
    throw new LedgerError("Currency not found", 404, { code: "currency.not_found" });
  }

  return deleteCurrencyCmd(userId, code, db);
}
