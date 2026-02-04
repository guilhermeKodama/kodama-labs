import type { DbClient } from "@capital/server/lib/prisma";

export async function fetchCurrenciesByUserId(userId: string, db: DbClient) {
  return db.currency.findMany({
    where: { userId },
    orderBy: { code: "asc" },
  });
}

export async function fetchCurrencyByCode(
  userId: string,
  code: string,
  db: DbClient
) {
  return db.currency.findUnique({
    where: {
      userId_code: { userId, code },
    },
  });
}
