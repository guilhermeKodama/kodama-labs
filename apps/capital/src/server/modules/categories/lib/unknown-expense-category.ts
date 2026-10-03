import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Name of the user's system "Other" expense category.
 * Until PR #64, looked up by name. The rebase replaces this body with:
 *   return (await getSystemCategory(userId, "other_system", db)).name;
 */
export async function unknownExpenseCategoryName(
  userId: string,
  db: DbClient
): Promise<string> {
  const other = await db.category.findFirst({
    where: { userId, name: "Other", type: "expense", isSystem: true },
    select: { name: true },
  });
  if (!other) {
    throw new Error('System expense category "Other" is missing for this user');
  }
  return other.name;
}
