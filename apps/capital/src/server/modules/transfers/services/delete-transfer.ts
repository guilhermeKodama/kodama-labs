import type { DbClient } from "@capital/server/lib/prisma";
import { deleteTransfer as deleteTransferCmd } from "../data/commands/delete-transfer";
import { fetchTransferById } from "../data/queries/fetch-transfers";

export async function deleteTransferService(id: string, db: DbClient) {
  const existing = await fetchTransferById(id, db);
  if (!existing) {
    throw new Error("Transfer not found");
  }

  return deleteTransferCmd(id, db);
}
