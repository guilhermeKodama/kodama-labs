import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Accounts, positions and recent movements - what the agent needs to
 * match a PDF's line items against existing holdings before deciding
 * whether something is a new position or an addition to one that exists.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchInvestmentHoldingsForAgent(
  userId: string,
  accountId: string | undefined,
  db: DbClient
) {
  const accounts = await db.investmentAccount.findMany({
    where: { userId, ...(accountId && { id: accountId }) },
    select: {
      id: true,
      name: true,
      broker: true,
      entityType: true,
      currency: true,
      cashBalance: true,
      externalId: true,
      holdings: {
        where: { isActive: true },
        select: {
          id: true,
          assetClass: true,
          subType: true,
          ticker: true,
          name: true,
          currency: true,
          currentQuantity: true,
          averageCost: true,
          totalInvested: true,
          transactions: {
            orderBy: { date: "desc" },
            take: 5,
            select: {
              id: true,
              type: true,
              quantity: true,
              pricePerUnit: true,
              totalAmount: true,
              date: true,
              externalId: true,
            },
          },
        },
      },
    },
  });

  if (accountId && accounts.length === 0) {
    throw new Error("Investment account not found or access denied");
  }

  return accounts;
}
