import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Every statement the user owns, with its purchases, in one query.
 */
export async function fetchStatements(userId: string, db: DbClient) {
  return db.creditCardStatement.findMany({
    where: {
      creditCard: {
        OR: [{ business: { userId } }, { personalAccount: { userId } }],
      },
    },
    include: {
      creditCard: {
        select: {
          id: true,
          entityType: true,
          businessId: true,
          personalAccountId: true,
          currency: true,
        },
      },
      purchases: {
        select: {
          id: true,
          amount: true,
          currency: true,
          category: true,
          description: true,
          transactionDate: true,
        },
        orderBy: { transactionDate: "asc" },
      },
    },
    orderBy: { month: "desc" },
  });
}
