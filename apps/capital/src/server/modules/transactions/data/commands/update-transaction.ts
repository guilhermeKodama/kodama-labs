import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";

interface UpdateTransactionData {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  date?: Date;
  isTaxDeductible?: boolean;
}

/**
 * Update a transaction, verifying user ownership first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The transaction ID
 * @param data - The data to update
 * @throws If transaction not found or not owned by user
 */
export async function updateTransaction(
  userId: string,
  id: string,
  data: UpdateTransactionData,
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

  return db.transaction.update({
    where: { id },
    data,
  });
}
