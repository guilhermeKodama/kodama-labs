import type { DbClient } from "@capital/server/lib/prisma";
import { updateCategory as updateCategoryCmd } from "../data/commands/update-category";
import { fetchCategoryById } from "../data/queries/fetch-categories";

interface UpdateCategoryInput {
  name?: string;
  color?: string;
  icon?: string;
}

export async function updateCategoryService(
  userId: string,
  id: string,
  input: UpdateCategoryInput,
  db: DbClient
) {
  const existing = await fetchCategoryById(userId, id, db);
  if (!existing) {
    throw new Error("Category not found");
  }

  if (existing.isDefault) {
    throw new Error("Cannot modify default categories");
  }

  // Data layer will verify ownership
  return updateCategoryCmd(userId, id, input, db);
}
