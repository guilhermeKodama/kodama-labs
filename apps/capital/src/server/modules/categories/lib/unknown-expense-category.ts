import type { DbClient } from "@capital/server/lib/prisma";
import { internalCategoryName } from "./internal-category";

/**
 * Name of the user's system "Other" expense category.
 * Delegates to internalCategoryName so the archived bypass stays explicit.
 */
export async function unknownExpenseCategoryName(
  userId: string,
  db: DbClient
): Promise<string> {
  return internalCategoryName(userId, "other_system", db);
}
