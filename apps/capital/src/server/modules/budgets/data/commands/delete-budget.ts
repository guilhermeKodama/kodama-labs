import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteBudget(id: string, db: DbClient) {
  return db.budget.delete({
    where: { id },
  });
}
