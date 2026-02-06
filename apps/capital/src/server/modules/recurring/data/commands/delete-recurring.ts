import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a recurring transaction, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The recurring transaction ID
 * @throws If recurring transaction not found or not owned by user
 */
export async function deleteRecurring(userId: string, id: string, db: DbClient) {
  // MANDATORY: Verify ownership through business or personalAccount
  const recurring = await db.recurringTransaction.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!recurring) {
    throw new Error("Recurring transaction not found");
  }

  return db.recurringTransaction.delete({
    where: { id },
  });
}
