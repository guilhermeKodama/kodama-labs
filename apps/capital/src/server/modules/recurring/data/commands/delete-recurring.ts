import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteRecurring(id: string, db: DbClient) {
  return db.recurringTransaction.delete({
    where: { id },
  });
}
