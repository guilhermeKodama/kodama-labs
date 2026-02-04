import type { DbClient } from "@capital/server/lib/prisma";

export async function updateCurrencyRate(
  userId: string,
  code: string,
  manualRate: number,
  db: DbClient
) {
  return db.currency.update({
    where: {
      userId_code: { userId, code },
    },
    data: { manualRate },
  });
}
