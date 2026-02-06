import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a business, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The business ID
 * @throws If business not found or not owned by user
 */
export async function deleteBusiness(userId: string, id: string, db: DbClient) {
  // First verify ownership
  const business = await db.business.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  return db.business.delete({
    where: { id },
  });
}
