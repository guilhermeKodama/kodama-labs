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

export async function listTransfers(filters: ListTransfersInput, db: DbClient) {
  return fetchTransfers(filters, db);
}
