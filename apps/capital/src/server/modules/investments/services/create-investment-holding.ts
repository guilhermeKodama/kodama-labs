import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass, FixedIncomeSubType } from "@/generated/prisma";
import { insertInvestmentHolding } from "../data/commands/insert-investment-holding";

interface CreateInvestmentHoldingInput {
  accountId: string;
  assetClass: AssetClass;
  subType?: FixedIncomeSubType;
  ticker?: string;
  name: string;
  currency: string;
}

export async function createInvestmentHolding(
  userId: string,
  input: CreateInvestmentHoldingInput,
  db: DbClient
) {
  return insertInvestmentHolding(userId, input, db);
}
