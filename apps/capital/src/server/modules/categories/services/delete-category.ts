import type { DbClient } from "@capital/server/lib/prisma";
import { deleteCategory as deleteCategoryCmd } from "../data/commands/delete-category";
import { fetchCategoryById } from "../data/queries/fetch-categories";

export async function deleteCategoryService(
  userId: string,
  id: string,
  db: DbClient
) {
  const existing = await fetchCategoryById(userId, id, db);
  if (!existing) {
    throw new Error("Category not found");
  }

  if (existing.isDefault) {
    throw new Error("Cannot delete default categories");
  }

  // Data layer will verify ownership
  return deleteCategoryCmd(userId, id, db);
}
