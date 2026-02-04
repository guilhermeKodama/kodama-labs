import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteCategory(id: string, db: DbClient) {
  return db.category.delete({
    where: { id },
  });
}
