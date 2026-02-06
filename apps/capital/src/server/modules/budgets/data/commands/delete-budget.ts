import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a budget, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The budget ID
 * @throws If budget not found or not owned by user
 */
export async function deleteBudget(userId: string, id: string, db: DbClient) {
  // MANDATORY: Verify ownership through business or personalAccount
  const budget = await db.budget.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!budget) {
    throw new Error("Budget not found");
  }

  return db.budget.delete({
    where: { id },
  });
}
