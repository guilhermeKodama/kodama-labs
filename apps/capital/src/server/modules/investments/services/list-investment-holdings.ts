import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass } from "@prisma/client";
import { fetchInvestmentHoldings } from "../data/queries/fetch-investment-holdings";

interface ListInvestmentHoldingsInput {
  accountId?: string;
  assetClass?: AssetClass;
  isActive?: boolean;
}

export async function listInvestmentHoldings(
  userId: string,
  filters: ListInvestmentHoldingsInput,
  db: DbClient
) {
  return fetchInvestmentHoldings(userId, filters, db);
}
