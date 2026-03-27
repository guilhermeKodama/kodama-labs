import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { insertCategory } from "../data/commands/insert-category";

interface CreateCategoryInput {
  userId: string;
  name: string;
  type: TransactionType;
  color?: string;
  icon?: string;
}

export async function createCategory(input: CreateCategoryInput, db: DbClient) {
  return insertCategory(input, db);
}
