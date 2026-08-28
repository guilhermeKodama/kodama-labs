import type { DbClient } from "@capital/server/lib/prisma";

interface LinkBillToTransactionInput {
  billId: string;
  transactionId: string;
}

/**
 * Link an existing expense Transaction to a bill (marks it paid). For
 * creating a NEW expense Transaction from a bill instead, see
 * create-bill-expense.ts - the two are mutually exclusive entry points to
 * the same `CreditCardBill.transactionId` field.
 */
export async function linkBillToTransaction(
  userId: string,
  input: LinkBillToTransactionInput,
  db: DbClient
) {
  const bill = await db.creditCardBill.findFirst({
    where: {
      id: input.billId,
      creditCard: { OR: [{ business: { userId } }, { personalAccount: { userId } }] },
    },
    select: { id: true, transactionId: true },
  });
  if (!bill) {
    throw new Error("Bill not found or access denied");
  }
  if (bill.transactionId) {
    throw new Error("Bill is already linked to a transaction");
  }

  const transaction = await db.transaction.findFirst({
    where: {
      id: input.transactionId,
      OR: [{ business: { userId } }, { personalAccount: { userId } }],
    },
    select: { id: true },
  });
  if (!transaction) {
    throw new Error("Transaction not found or access denied");
  }

  return db.creditCardBill.update({
    where: { id: input.billId },
    data: { transactionId: input.transactionId, status: "paid" },
  });
}
