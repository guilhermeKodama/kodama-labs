import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a credit card bill and its transactions, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The bill ID
 * @throws If bill not found or not owned by user
 */
export async function deleteBill(
  userId: string,
  id: string,
  db: DbClient
) {
  // MANDATORY: Verify ownership through creditCard -> business/personalAccount
  const bill = await db.creditCardBill.findFirst({
    where: {
      id,
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    },
    select: { id: true },
  });

  if (!bill) {
    throw new Error("Bill not found");
  }

  // Cascade delete will remove bill transactions and installments
  return db.creditCardBill.delete({
    where: { id },
  });
}
