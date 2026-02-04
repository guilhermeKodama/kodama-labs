import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@prisma/client";

interface CreateCategoryData {
  userId: string;
  name: string;
  type: TransactionType;
  color?: string;
  icon?: string;
}

export async function insertCategory(data: CreateCategoryData, db: DbClient) {
  return db.category.create({
    data,
  });
}
