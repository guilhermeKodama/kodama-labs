import type { DbClient } from "@capital/server/lib/prisma";
import { deleteInvestmentHolding as deleteCmd } from "../data/commands/delete-investment-holding";

export async function deleteInvestmentHoldingService(
  userId: string,
  id: string,
  db: DbClient
) {
  return deleteCmd(userId, id, db);
}
