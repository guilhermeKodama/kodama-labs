import type { DbClient } from "@capital/server/lib/prisma";
import { getSystemCategory } from "./system-categories";

/**
 * Resolve a system category for an internal write.
 *
 * Installment rows (`credit_card`), the unknown-expense fallback
 * (`other_system`), the statement income fallback (`other_income`), and the
 * bill/statement cron categorizers must call this. It returns the current
 * name even when the row is archived, and it does not unarchive the row.
 *
 * User-facing assignment goes through `rejectArchivedAssignment` instead.
 * Do not add a new internal writer that skips this helper.
 */
export async function internalCategoryName(
  userId: string,
  systemKey: string,
  db: DbClient
): Promise<string> {
  return (await getSystemCategory(userId, systemKey, db)).name;
}
