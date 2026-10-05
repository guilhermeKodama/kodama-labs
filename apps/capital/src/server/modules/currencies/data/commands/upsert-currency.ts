import type { DbClient } from "@capital/server/lib/prisma";

interface UpsertCurrencyData {
  userId: string;
  code: string;
  name: string;
  symbol: string;
  manualRate: number;
}

/** Adds or replaces a currency with a rate the user typed (labelled manual, which the automatic refresh leaves alone). */
export async function upsertCurrency(data: UpsertCurrencyData, db: DbClient, now: Date = new Date()) {
  const rate = { manualRate: data.manualRate, source: "manual", rateUpdatedAt: now };
  return db.currency.upsert({
    where: { userId_code: { userId: data.userId, code: data.code } },
    update: { name: data.name, symbol: data.symbol, ...rate },
    create: { ...data, ...rate },
  });
}
