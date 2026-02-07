import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteInvestmentHolding(
  userId: string,
  id: string,
  db: DbClient
) {
  const holding = await db.investmentHolding.findFirst({
    where: {
      id,
      account: { userId },
    },
    select: { id: true },
  });

  if (!holding) {
    throw new Error("Investment holding not found");
  }

  return db.investmentHolding.delete({
    where: { id },
  });
}
