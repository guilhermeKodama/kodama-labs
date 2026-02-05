import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteRecurringTransfer(id: string, db: DbClient) {
  return db.recurringTransfer.delete({
    where: { id },
  });
}
