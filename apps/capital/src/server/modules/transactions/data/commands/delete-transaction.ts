import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a transaction, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The transaction ID
 * @throws If transaction not found or not owned by user
 */
export async function deleteTransaction(
  userId: string,
  id: string,
  db: DbClient
) {
  // MANDATORY: Verify ownership through business or personalAccount
  const transaction = await db.transaction.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  return db.transaction.delete({
    where: { id },
  });
}
