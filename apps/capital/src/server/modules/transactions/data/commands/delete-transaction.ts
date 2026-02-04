import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteTransaction(id: string, db: DbClient) {
  return db.transaction.delete({
    where: { id },
  });
}
