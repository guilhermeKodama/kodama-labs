import type { DbClient } from "@capital/server/lib/prisma";

interface UpsertCurrencyData {
  userId: string;
  code: string;
  name: string;
  symbol: string;
  manualRate: number;
}

export async function upsertCurrency(data: UpsertCurrencyData, db: DbClient) {
  return db.currency.upsert({
    where: {
      userId_code: { userId: data.userId, code: data.code },
    },
    update: {
      name: data.name,
      symbol: data.symbol,
      manualRate: data.manualRate,
    },
    create: data,
  });
}
