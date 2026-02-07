import type { DbClient } from "@capital/server/lib/prisma";
import { updateInvestmentAccount as updateCmd } from "../data/commands/update-investment-account";

interface UpdateInvestmentAccountInput {
  name?: string;
  broker?: string;
  currency?: string;
  isActive?: boolean;
}

export async function updateInvestmentAccountService(
  userId: string,
  id: string,
  input: UpdateInvestmentAccountInput,
  db: DbClient
) {
  return updateCmd(userId, id, input, db);
}
