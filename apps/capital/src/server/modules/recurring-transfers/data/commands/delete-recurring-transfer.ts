import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a recurring transfer, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The recurring transfer ID
 * @throws If recurring transfer not found or not owned by user
 */
export async function deleteRecurringTransfer(
  userId: string,
  id: string,
  db: DbClient
) {
  // MANDATORY: Verify ownership through business or personalAccount
  const recurringTransfer = await db.recurringTransfer.findFirst({
    where: {
      id,
      OR: [
        { fromBusiness: { userId } },
        { fromPersonalAccount: { userId } },
        { toBusiness: { userId } },
        { toPersonalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!recurringTransfer) {
    throw new Error("Recurring transfer not found");
  }

  return db.recurringTransfer.delete({
    where: { id },
  });
}
