import type { DbClient } from "@capital/server/lib/prisma";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";

export { getSystemCategory, ensureSystemCategories, getSystemCategoryNames } from "@capital/server/modules/categories/lib/system-categories";

/**
 * Get a category by its systemKey for a given user.
 * travel_system and travel_default resolve to the same row. Self-heals a missing key.
 */
export async function getCategoryBySystemKey(
  userId: string,
  systemKey: string,
  db: DbClient
) {
  return getSystemCategory(userId, systemKey, db);
}

/**
 * Get the current name of a category by its systemKey.
 */
export async function getCategoryNameBySystemKey(
  userId: string,
  systemKey: string,
  db: DbClient
): Promise<string> {
  const category = await getSystemCategory(userId, systemKey, db);
  return category.name;
}
