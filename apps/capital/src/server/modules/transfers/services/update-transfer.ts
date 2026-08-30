import type { DbClient } from "@capital/server/lib/prisma";
import { updateTransfer as updateTransferCmd } from "../data/commands/update-transfer";

export async function updateTransferService(
  userId: string,
  id: string,
  input: Parameters<typeof updateTransferCmd>[2],
  db: DbClient
) {
  // Look up the pre-update state to reverse any investment cash balance effect
  const previous = await db.transfer.findFirst({
    where: { id },
    select: {
      direction: true,
      amount: true,
      toInvestmentAccountId: true,
      fromInvestmentAccountId: true,
    },
  });

  // Update the transfer (data layer verifies ownership)
  const transfer = await updateTransferCmd(userId, id, input, db);

  // Reverse the previous investment account cash balance effect
  if (previous) {
    if (previous.direction === "investment_deposit" && previous.toInvestmentAccountId) {
      await db.investmentAccount.update({
        where: { id: previous.toInvestmentAccountId },
        data: { cashBalance: { decrement: previous.amount } },
      });
    }

    if (previous.direction === "investment_withdrawal" && previous.fromInvestmentAccountId) {
      await db.investmentAccount.update({
        where: { id: previous.fromInvestmentAccountId },
        data: { cashBalance: { increment: previous.amount } },
      });
    }
  }

  // Apply the new investment account cash balance effect
  if (transfer.direction === "investment_deposit" && transfer.toInvestmentAccountId) {
    await db.investmentAccount.update({
      where: { id: transfer.toInvestmentAccountId },
      data: { cashBalance: { increment: transfer.amount } },
    });
  }

  if (transfer.direction === "investment_withdrawal" && transfer.fromInvestmentAccountId) {
    await db.investmentAccount.update({
      where: { id: transfer.fromInvestmentAccountId },
      data: { cashBalance: { decrement: transfer.amount } },
    });
  }

  return transfer;
}
