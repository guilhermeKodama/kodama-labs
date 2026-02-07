import type { DbClient } from "@capital/server/lib/prisma";
import { deleteInvestmentAccount as deleteCmd } from "../data/commands/delete-investment-account";

export async function deleteInvestmentAccountService(
  userId: string,
  id: string,
  db: DbClient
) {
  return deleteCmd(userId, id, db);
}
