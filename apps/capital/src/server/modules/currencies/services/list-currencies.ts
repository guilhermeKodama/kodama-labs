import type { DbClient } from "@capital/server/lib/prisma";
import { fetchCurrenciesByUserId } from "../data/queries/fetch-currencies";

export async function listCurrencies(userId: string, db: DbClient) {
  return fetchCurrenciesByUserId(userId, db);
}
