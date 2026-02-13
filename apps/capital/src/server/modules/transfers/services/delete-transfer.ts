import type { DbClient } from "@capital/server/lib/prisma";
import { deleteTransfer as deleteTransferCmd } from "../data/commands/delete-transfer";

export async function deleteTransferService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Look up transfer to check if it involves an investment account
  const transfer = await db.transfer.findFirst({
    where: { id },
    select: {
      direction: true,
      amount: true,
      toInvestmentAccountId: true,
      fromInvestmentAccountId: true,
    },
  });

  // Delete the transfer (data layer verifies ownership)
  await deleteTransferCmd(userId, id, db);

  // Reverse investment account cash balance changes
  if (transfer) {
    if (transfer.direction === "investment_deposit" && transfer.toInvestmentAccountId) {
      await db.investmentAccount.update({
        where: { id: transfer.toInvestmentAccountId },
        data: { cashBalance: { decrement: transfer.amount } },
      });
    }

    if (transfer.direction === "investment_withdrawal" && transfer.fromInvestmentAccountId) {
      await db.investmentAccount.update({
        where: { id: transfer.fromInvestmentAccountId },
        data: { cashBalance: { increment: transfer.amount } },
      });
    }
  }
}
