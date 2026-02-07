import type { DbClient } from "@capital/server/lib/prisma";
import { deleteInvestmentTransaction as deleteCmd } from "../data/commands/delete-investment-transaction";
import { recalculateHolding } from "./recalculate-holding";

export async function deleteInvestmentTransactionService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Get holding ID before delete
  const existing = await db.investmentTransaction.findFirst({
    where: { id, holding: { account: { userId } } },
    select: { holdingId: true },
  });

  if (!existing) {
    throw new Error("Investment transaction not found");
  }

  await deleteCmd(userId, id, db);

  // Recalculate holding
  await recalculateHolding(userId, existing.holdingId, db);
}
