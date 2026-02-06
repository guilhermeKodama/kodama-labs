import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransactionType } from "@prisma/client";

interface CreateTransactionData {
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate: number;
  description: string;
  category: string;
  date: Date;
  isTaxDeductible?: boolean;
  businessId?: string;
  personalAccountId?: string;
  recurringTransactionId?: string;
}

/**
 * Insert a new transaction after verifying user ownership of the target entity.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param data - The transaction data
 * @throws If the target business/personalAccount is not owned by the user
 */
export async function insertTransaction(
  userId: string,
  data: CreateTransactionData,
  db: DbClient
) {
  // MANDATORY: Verify user owns the target entity before creating transaction
  if (data.businessId) {
    const business = await db.business.findFirst({
      where: { id: data.businessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Business not found or access denied");
    }
  }

  if (data.personalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: data.personalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Personal account not found or access denied");
    }
  }

  return db.transaction.create({
    data,
  });
}
