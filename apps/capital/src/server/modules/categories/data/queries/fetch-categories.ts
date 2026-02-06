import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@prisma/client";

/**
 * Fetch categories for a user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param type - Optional filter by transaction type
 */
export async function fetchCategoriesByUserId(
  userId: string,
  type: TransactionType | undefined,
  db: DbClient
) {
  return db.category.findMany({
    where: {
      userId,
      ...(type && { type }),
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Fetch a single category by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The category ID
 * @returns The category if found and owned by user, null otherwise
 */
export async function fetchCategoryById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.category.findFirst({
    where: { id, userId },
  });
}
