import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Create or update installment tracking for a bill transaction that has installment info.
 */
export async function createInstallmentFromBillTransaction(
  userId: string,
  billTransactionId: string,
  db: DbClient
) {
  // Fetch bill transaction with ownership verification
  const billTransaction = await db.billTransaction.findFirst({
    where: {
      id: billTransactionId,
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
      bill: {
        include: { creditCard: true },
      },
    },
  });

  if (!billTransaction) {
    throw new Error("Bill transaction not found or access denied");
  }

  if (!billTransaction.totalInstallments || billTransaction.totalInstallments <= 1) {
    throw new Error("Transaction does not have installment info");
  }

  const totalAmount = billTransaction.amount * billTransaction.totalInstallments;

  return db.installment.create({
    data: {
      creditCardId: billTransaction.bill.creditCardId,
      billTransactionId: billTransaction.id,
      description: billTransaction.description,
      totalAmount,
      totalInstallments: billTransaction.totalInstallments,
      paidInstallments: billTransaction.installmentNumber || 1,
      startDate: billTransaction.transactionDate,
      installmentAmount: billTransaction.amount,
      isActive: (billTransaction.installmentNumber || 1) < billTransaction.totalInstallments,
    },
  });
}

/**
 * Calculate projected future installment amounts by month.
 */
export function calculateFutureInstallments(
  installments: Array<{
    installmentAmount: number;
    totalInstallments: number;
    paidInstallments: number;
    startDate: Date;
  }>
) {
  const projections: Record<string, number> = {};

  for (const inst of installments) {
    const remaining = inst.totalInstallments - inst.paidInstallments;
    if (remaining <= 0) continue;

    const startDate = new Date(inst.startDate);

    for (let i = 0; i < remaining; i++) {
      const futureMonth = new Date(startDate);
      futureMonth.setMonth(futureMonth.getMonth() + inst.paidInstallments + i);
      const key = `${futureMonth.getFullYear()}-${String(futureMonth.getMonth() + 1).padStart(2, "0")}`;

      projections[key] = (projections[key] || 0) + inst.installmentAmount;
    }
  }

  return projections;
}
