import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@prisma/client";
import { fetchRecurringTransactions } from "../data/queries/fetch-recurring";

interface ListRecurringInput {
  businessId?: string;
  personalAccountId?: string;
  entityType?: EntityType;
  isActive?: boolean;
}

export async function listRecurring(filters: ListRecurringInput, db: DbClient) {
  return fetchRecurringTransactions(filters, db);
}
