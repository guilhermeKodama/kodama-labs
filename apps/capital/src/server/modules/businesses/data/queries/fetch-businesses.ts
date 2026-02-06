import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Fetch all businesses for a user.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchBusinessesByUserId(userId: string, db: DbClient) {
  return db.business.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Fetch a single business by ID, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The business ID
 * @returns The business if found and owned by user, null otherwise
 */
export async function fetchBusinessById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.business.findFirst({
    where: { id, userId },
  });
}
