import type { DbClient } from "@capital/server/lib/prisma";
import { getSystemCategory } from "./system-categories";

/**
 * Name of the user's system "Other" expense category.
 */
export async function unknownExpenseCategoryName(
  userId: string,
  db: DbClient
): Promise<string> {
  return (await getSystemCategory(userId, "other_system", db)).name;
}
