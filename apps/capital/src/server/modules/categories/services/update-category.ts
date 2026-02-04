import type { DbClient } from "@capital/server/lib/prisma";
import { updateCategory as updateCategoryCmd } from "../data/commands/update-category";
import { fetchCategoryById } from "../data/queries/fetch-categories";

interface UpdateCategoryInput {
  name?: string;
  color?: string;
  icon?: string;
}

export async function updateCategoryService(
  id: string,
  input: UpdateCategoryInput,
  db: DbClient
) {
  const existing = await fetchCategoryById(id, db);
  if (!existing) {
    throw new Error("Category not found");
  }

  if (existing.isDefault) {
    throw new Error("Cannot modify default categories");
  }

  return updateCategoryCmd(id, input, db);
}
