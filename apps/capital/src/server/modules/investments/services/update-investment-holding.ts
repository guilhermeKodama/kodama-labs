import type { DbClient } from "@capital/server/lib/prisma";
import type { FixedIncomeSubType } from "@prisma/client";
import { updateInvestmentHolding as updateCmd } from "../data/commands/update-investment-holding";

interface UpdateInvestmentHoldingInput {
  name?: string;
  ticker?: string;
  subType?: FixedIncomeSubType;
  isActive?: boolean;
}

export async function updateInvestmentHoldingService(
  userId: string,
  id: string,
  input: UpdateInvestmentHoldingInput,
  db: DbClient
) {
  return updateCmd(userId, id, input, db);
}
