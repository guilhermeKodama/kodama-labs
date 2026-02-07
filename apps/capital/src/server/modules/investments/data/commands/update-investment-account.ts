import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateInvestmentAccountData {
  name?: string;
  broker?: string;
  currency?: string;
  isActive?: boolean;
}

export async function updateInvestmentAccount(
  userId: string,
  id: string,
  data: UpdateInvestmentAccountData,
  db: DbClient
) {
  const account = await db.investmentAccount.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!account) {
    throw new Error("Investment account not found");
  }

  return db.investmentAccount.update({
    where: { id },
    data,
  });
}
