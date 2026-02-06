import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a transfer, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The transfer ID
 * @throws If transfer not found or not owned by user
 */
export async function deleteTransfer(userId: string, id: string, db: DbClient) {
  // MANDATORY: Verify ownership through business or personalAccount
  const transfer = await db.transfer.findFirst({
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

  if (!transfer) {
    throw new Error("Transfer not found");
  }

  return db.transfer.delete({
    where: { id },
  });
}
