import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a category, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The category ID
 * @throws If category not found or not owned by user
 */
export async function deleteCategory(userId: string, id: string, db: DbClient) {
  // MANDATORY: Verify ownership
  const category = await db.category.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!category) {
    throw new Error("Category not found");
  }

  return db.category.delete({
    where: { id },
  });
}
