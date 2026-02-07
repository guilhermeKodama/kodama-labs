import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteInvestmentTransaction(
  userId: string,
  id: string,
  db: DbClient
) {
  const transaction = await db.investmentTransaction.findFirst({
    where: {
      id,
      holding: { account: { userId } },
    },
    select: { id: true, holdingId: true },
  });

  if (!transaction) {
    throw new Error("Investment transaction not found");
  }

  return db.investmentTransaction.delete({
    where: { id },
  });
}
