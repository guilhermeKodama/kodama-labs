import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Update a bill transaction's category, scoped to the authenticated user.
 */
export async function updateBillTransaction(
  userId: string,
  id: string,
  data: { category: string },
  db: DbClient
) {
  // MANDATORY: Verify ownership through bill -> creditCard -> business/personalAccount
  const billTx = await db.billTransaction.findFirst({
    where: {
      id,
      bill: {
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
    },
    select: { id: true },
  });

  if (!billTx) {
    throw new Error("Bill transaction not found");
  }

  return db.billTransaction.update({
    where: { id },
    data: {
      category: data.category,
      isAutoCategorized: false, // Mark as manually categorized
    },
  });
}
