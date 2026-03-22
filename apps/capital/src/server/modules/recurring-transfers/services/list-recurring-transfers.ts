import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";
import { fetchRecurringTransfers } from "../data/queries/fetch-recurring-transfers";

interface ListRecurringTransfersFilters {
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
  fromEntityType?: EntityType;
  toEntityType?: EntityType;
  isActive?: boolean;
}

export async function listRecurringTransfers(
  userId: string,
  filters: ListRecurringTransfersFilters,
  db: DbClient
) {
  return fetchRecurringTransfers(userId, filters, db);
}
