import type { DbClient } from "@capital/server/lib/prisma";
import { deleteTransaction as deleteTransactionCmd } from "../data/commands/delete-transaction";
import { fetchTransactionById } from "../data/queries/fetch-transactions";

export async function deleteTransactionService(id: string, db: DbClient) {
  const existing = await fetchTransactionById(id, db);
  if (!existing) {
    throw new Error("Transaction not found");
  }

  return deleteTransactionCmd(id, db);
}
