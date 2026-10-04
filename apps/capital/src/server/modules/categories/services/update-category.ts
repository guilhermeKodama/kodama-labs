import type { DbClient } from "@capital/server/lib/prisma";
import { updateCategory as updateCategoryCmd } from "../data/commands/update-category";
import { fetchCategoryById } from "../data/queries/fetch-categories";

interface UpdateCategoryInput {
  name?: string;
  color?: string;
  icon?: string;
  isArchived?: boolean;
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

  // Everything except isArchived stays locked on default categories.
  // Archiving hides the row from pickers without breaking systemKey.
  const changesContent = Object.entries(input).some(
    ([key, value]) => key !== "isArchived" && value !== undefined
  );
  if (existing.isDefault && changesContent) {
    throw new Error("Cannot modify default categories");
  }

  // Data layer will verify ownership
  return updateCategoryCmd(userId, id, input, db);
}
