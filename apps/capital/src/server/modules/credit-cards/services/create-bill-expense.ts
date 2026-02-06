import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@prisma/client";

interface CreateBillExpenseInput {
  billId: string;
  entityType: EntityType;
  businessId?: string;
  personalAccountId?: string;
  currency: string;
  exchangeRate?: number;
  date: Date;
}

/**
 * Create an expense Transaction from a credit card bill and link them.
 * This allows the bill to appear as a single expense in the transaction system.
 */
export async function createBillExpense(
  userId: string,
  input: CreateBillExpenseInput,
  db: DbClient
) {
  // Fetch bill and verify ownership
  const bill = await db.creditCardBill.findFirst({
    where: {
      id: input.billId,
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    },
    include: {
      creditCard: true,
    },
  });

  if (!bill) {
    throw new Error("Bill not found or access denied");
  }

  if (bill.transactionId) {
    throw new Error("Bill is already linked to an expense transaction");
  }

  // Create expense transaction
  const transaction = await db.transaction.create({
    data: {
      entityType: input.entityType,
      type: "expense",
      amount: bill.totalAmount,
      currency: input.currency,
      exchangeRate: input.exchangeRate || 1,
      description: `Credit Card Bill - ${bill.creditCard.bankName} ****${bill.creditCard.lastFourDigits}`,
      category: "Credit Card",
      date: input.date,
      isTaxDeductible: false,
      businessId: input.entityType === "business" ? input.businessId : undefined,
      personalAccountId: input.entityType === "personal" ? input.personalAccountId : undefined,
    },
  });

  // Link bill to the transaction and mark as paid
  await db.creditCardBill.update({
    where: { id: input.billId },
    data: { transactionId: transaction.id, status: "paid" },
  });

  return transaction;
}
