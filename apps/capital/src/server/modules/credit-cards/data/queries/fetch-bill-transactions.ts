import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Fetch bill transactions for a specific bill, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param billId - The bill ID
 */
export async function fetchBillTransactions(
  userId: string,
  billId: string,
  db: DbClient
) {
  return db.billTransaction.findMany({
    where: {
      billId,
      // MANDATORY: Verify ownership through bill -> creditCard -> business/personalAccount
      bill: {
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
    },
    include: {
      installment: true,
    },
    orderBy: { transactionDate: "desc" },
  });
}
