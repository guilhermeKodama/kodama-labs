import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Get a category by its systemKey for a given user.
 * Returns the category with its current (possibly localized) name.
 * 
 * Example: getCategoryBySystemKey(userId, "credit_card", db)
 *   Returns the user's credit card category, whether it's still named "Credit Card"
 *   or has been renamed to "Cartão de Crédito".
 */
export async function getCategoryBySystemKey(
  userId: string,
  systemKey: string,
  db: DbClient
) {
  return db.category.findUnique({
    where: {
      userId_systemKey: {
        userId,
        systemKey,
      },
    },
  });
}

/**
 * Get the current name of a category by its systemKey.
 * Returns the name string or null if the category doesn't exist.
 */
export async function getCategoryNameBySystemKey(
  userId: string,
  systemKey: string,
  db: DbClient
): Promise<string | null> {
  const category = await getCategoryBySystemKey(userId, systemKey, db);
  return category?.name ?? null;
}
