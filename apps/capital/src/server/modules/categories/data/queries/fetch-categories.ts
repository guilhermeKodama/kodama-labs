import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";

/**
 * Fetch categories for a user.
 * Archived rows are hidden unless includeArchived is set. Callers that
 * resolve existing names (orphan detection, assignment checks) opt in.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param type - Optional filter by transaction type
 */
export async function fetchCategoriesByUserId(
  userId: string,
  type: TransactionType | undefined,
  db: DbClient,
  options?: { includeArchived?: boolean }
) {
  return db.category.findMany({
    where: {
      userId,
      ...(type && { type }),
      ...(!options?.includeArchived && { isArchived: false }),
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
