import type { DbClient } from "@capital/server/lib/prisma";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { legacyEntityRef } from "@capital/server/modules/ledger/services/entities";

/**
 * Accounts, positions and recent movements - what the agent needs to
 * match a PDF's line items against existing holdings before deciding
 * whether something is a new position or an addition to one that exists.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchInvestmentHoldingsForAgent(userId: string, accountId: string | undefined, db: DbClient) {
  const accounts = await db.account.findMany({
    where: { userId, type: "brokerage", ...(accountId && { id: accountId }) },
    include: {
      entity: { select: { id: true, kind: true } },
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
          operations: {
            orderBy: { date: "desc" },
            take: 5,
            select: { id: true, type: true, quantity: true, pricePerUnit: true, totalAmount: true, date: true, externalId: true },
          },
        },
      },
    },
  });
  if (accountId && accounts.length === 0) throw new Error("Investment account not found or access denied");
  const balances = await accountBalances(userId, db, accounts.map((a) => a.id));
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    broker: a.institution,
    entityType: legacyEntityRef(a.entity).entityType,
    currency: a.currency,
    cashBalance: Math.round((balances.get(a.id) ?? 0) * 100) / 100,
    externalId: a.externalId,
    holdings: a.holdings.map(({ operations, ...h }) => ({ ...h, transactions: operations })),
  }));
}
