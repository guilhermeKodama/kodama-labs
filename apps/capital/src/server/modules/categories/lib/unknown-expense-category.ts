import type { DbClient } from "@capital/server/lib/prisma";
import { getSystemCategory } from "./system-categories";

/**
 * Name of the user's system "Other" expense category.
 * Resolves the row even when it is archived and does not unarchive it.
 * Callers that write this name are internal fallbacks and must not run the
 * user-facing archived-assignment check.
 */
export async function unknownExpenseCategoryName(
  userId: string,
  db: DbClient
): Promise<string> {
  return (await getSystemCategory(userId, "other_system", db)).name;
}
