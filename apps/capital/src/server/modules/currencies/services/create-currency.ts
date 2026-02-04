import type { DbClient } from "@capital/server/lib/prisma";
import { upsertCurrency } from "../data/commands/upsert-currency";

interface CreateCurrencyInput {
  userId: string;
  code: string;
  name: string;
  symbol: string;
  manualRate: number;
}

export async function createCurrency(input: CreateCurrencyInput, db: DbClient) {
  return upsertCurrency(input, db);
}
