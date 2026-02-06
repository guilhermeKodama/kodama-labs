import type { DbClient } from "@capital/server/lib/prisma";
import { fetchTransfers } from "../data/queries/fetch-transfers";

interface ListTransfersInput {
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function listTransfers(
  userId: string,
  filters: ListTransfersInput,
  db: DbClient
) {
  return fetchTransfers(userId, filters, db);
}
