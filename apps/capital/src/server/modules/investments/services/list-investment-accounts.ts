import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";
import { fetchInvestmentAccounts } from "../data/queries/fetch-investment-accounts";

interface ListInvestmentAccountsInput {
  entityType?: EntityType;
  isActive?: boolean;
}

export async function listInvestmentAccounts(
  userId: string,
  filters: ListInvestmentAccountsInput,
  db: DbClient
) {
  return fetchInvestmentAccounts(userId, filters, db);
}
