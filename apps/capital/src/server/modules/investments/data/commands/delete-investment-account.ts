import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteInvestmentAccount(
  userId: string,
  id: string,
  db: DbClient
) {
  const account = await db.investmentAccount.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!account) {
    throw new Error("Investment account not found");
  }

  return db.investmentAccount.delete({
    where: { id },
  });
}
