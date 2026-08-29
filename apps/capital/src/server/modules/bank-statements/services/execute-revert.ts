import type { PrismaClient } from "@/generated/prisma";
import { recalculateHolding } from "@capital/server/modules/investments/services/recalculate-holding";
import type { CreatedRecordRef } from "./execute-import";

export interface RevertPlanPayload {
  statementImportId: string;
  createdRecords: CreatedRecordRef[];
}

export interface ExecuteRevertResult {
  transactionsDeleted: number;
  transfersDeleted: number;
  creditCardsDeleted: number;
  billsDeleted: number;
  investmentTransactionsDeleted: number;
}

/**
 * Undo an agent-driven import batch. Deliberately conservative: never
 * deletes an InvestmentHolding even if this batch created it (the user
 * may have added other data to it since) - only the InvestmentTransaction
 * rows the batch created are removed, then the holding's aggregates are
 * recalculated. Everything else this batch created (Transaction, Transfer,
 * CreditCard, CreditCardBill) is deleted outright - deleting a
 * CreditCardBill cascades its BillTransaction/Installment rows, so those
 * never need their own createdRecords entries. The StatementImport row
 * itself is kept as history and stamped with revertedAt rather than
 * deleted.
 *
 * Referential integrity is the second line of defense: if something this
 * batch created has since been referenced elsewhere (e.g. a credit card
 * that now has bills), the delete fails with a foreign-key error and the
 * whole transaction rolls back - a safe failure, never a partial revert.
 */
export async function executeRevert(
  userId: string,
  payload: RevertPlanPayload,
  db: PrismaClient
): Promise<ExecuteRevertResult> {
  return db.$transaction(async (tx) => {
    const statementImport = await tx.statementImport.findFirst({
      where: { id: payload.statementImportId, userId },
    });
    if (!statementImport) {
      throw new Error("Statement import not found or access denied");
    }
    if (statementImport.revertedAt) {
      throw new Error("This import was already reverted");
    }

    const idsFor = (model: string) =>
      payload.createdRecords.filter((r) => r.model === model).map((r) => r.id);

    const investmentTransactionIds = idsFor("InvestmentTransaction");
    const affectedHoldingIds =
      investmentTransactionIds.length > 0
        ? (
            await tx.investmentTransaction.findMany({
              where: { id: { in: investmentTransactionIds } },
              select: { holdingId: true },
            })
          ).map((t) => t.holdingId)
        : [];

    const investmentTransactionsDeleted =
      investmentTransactionIds.length > 0
        ? (
            await tx.investmentTransaction.deleteMany({
              where: { id: { in: investmentTransactionIds }, holding: { account: { userId } } },
            })
          ).count
        : 0;

    for (const holdingId of new Set(affectedHoldingIds)) {
      await recalculateHolding(userId, holdingId, tx);
    }

    const transferIds = idsFor("Transfer");
    const transfersDeleted =
      transferIds.length > 0
        ? (
            await tx.transfer.deleteMany({
              where: {
                id: { in: transferIds },
                OR: [
                  { fromBusiness: { userId } },
                  { fromPersonalAccount: { userId } },
                  { toBusiness: { userId } },
                  { toPersonalAccount: { userId } },
                ],
              },
            })
          ).count
        : 0;

    // Deleted before CreditCard: if this batch also created the owning
    // card, deleting the card would cascade this away anyway, but a bill
    // on a pre-existing card needs this explicit delete - either way the
    // cascade below takes BillTransaction/Installment with it.
    const billIds = idsFor("CreditCardBill");
    const billsDeleted =
      billIds.length > 0
        ? (
            await tx.creditCardBill.deleteMany({
              where: {
                id: { in: billIds },
                creditCard: { OR: [{ business: { userId } }, { personalAccount: { userId } }] },
              },
            })
          ).count
        : 0;

    const creditCardIds = idsFor("CreditCard");
    const creditCardsDeleted =
      creditCardIds.length > 0
        ? (
            await tx.creditCard.deleteMany({
              where: {
                id: { in: creditCardIds },
                OR: [{ business: { userId } }, { personalAccount: { userId } }],
              },
            })
          ).count
        : 0;

    const transactionIds = idsFor("Transaction");
    const transactionsDeleted =
      transactionIds.length > 0
        ? (
            await tx.transaction.deleteMany({
              where: {
                id: { in: transactionIds },
                OR: [{ business: { userId } }, { personalAccount: { userId } }],
              },
            })
          ).count
        : 0;

    await tx.statementImport.update({
      where: { id: payload.statementImportId },
      data: { revertedAt: new Date() },
    });

    return {
      transactionsDeleted,
      transfersDeleted,
      creditCardsDeleted,
      billsDeleted,
      investmentTransactionsDeleted,
    };
  });
}
