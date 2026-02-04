import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@prisma/client";

export async function fetchCategoriesByUserId(
  userId: string,
  type?: TransactionType,
  db?: DbClient
) {
  return db!.category.findMany({
    where: {
      userId,
      ...(type && { type }),
    },
    orderBy: { name: "asc" },
  });
}

export async function fetchCategoryById(id: string, db: DbClient) {
  return db.category.findUnique({
    where: { id },
  });
}
