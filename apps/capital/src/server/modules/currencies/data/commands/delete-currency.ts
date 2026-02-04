import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteCurrency(
  userId: string,
  code: string,
  db: DbClient
) {
  return db.currency.delete({
    where: {
      userId_code: { userId, code },
    },
  });
}
