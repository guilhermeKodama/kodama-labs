import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateCategoryData {
  name?: string;
  color?: string;
  icon?: string;
}

/**
 * Update a category, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The category ID
 * @param data - The data to update
 * @throws If category not found or not owned by user
 */
export async function updateCategory(
  userId: string,
  id: string,
  data: UpdateCategoryData,
  db: DbClient
) {
  // MANDATORY: Verify ownership
  const category = await db.category.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!category) {
    throw new Error("Category not found");
  }

  return db.category.update({
    where: { id },
    data,
  });
}
