import type { DbClient } from "@capital/server/lib/prisma";
import type {
  ExistingTransactionData,
  EntityInfo,
  InvestmentAccountInfo,
} from "@capital/server/modules/bank-statements/services/reconciliation";

/**
 * Loads the same reconciliation context the manual-upload wizard uses
 * (apps/capital/.../bank-statements/routes/v1/post-parse.ts): every one
 * of the user's transactions across ALL entities, for fuzzy-matching
 * purposes - a transaction the user entered manually under the wrong
 * entity should still be found.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchReconciliationContext(
  userId: string,
  db: DbClient
): Promise<{
  existingTransactions: ExistingTransactionData[];
  entities: EntityInfo[];
  investmentAccounts: InvestmentAccountInfo[];
  knownTransferFitIds: Set<string>;
}> {
  const [transactions, businesses, investmentAccounts, businessIds, personalAccountIds] =
    await Promise.all([
      db.transaction.findMany({
        where: { OR: [{ business: { userId } }, { personalAccount: { userId } }] },
        select: { id: true, externalId: true, amount: true, date: true, description: true, type: true },
      }),
      db.business.findMany({ where: { userId }, select: { id: true, name: true } }),
      db.investmentAccount.findMany({ where: { userId }, select: { id: true, name: true } }),
      db.business.findMany({ where: { userId }, select: { id: true } }),
      db.personalAccount.findMany({ where: { userId }, select: { id: true } }),
    ]);

  const bizIds = businessIds.map((b) => b.id);
  const paIds = personalAccountIds.map((p) => p.id);

  const transfersWithFitId = await db.transfer.findMany({
    where: {
      externalId: { not: null },
      OR: [
        ...(bizIds.length ? [{ fromBusinessId: { in: bizIds } }, { toBusinessId: { in: bizIds } }] : []),
        ...(paIds.length
          ? [{ fromPersonalAccountId: { in: paIds } }, { toPersonalAccountId: { in: paIds } }]
          : []),
      ],
    },
    select: { externalId: true },
  });

  return {
    existingTransactions: transactions.map((t) => ({
      id: t.id,
      externalId: t.externalId,
      amount: t.amount,
      date: t.date,
      description: t.description,
      type: t.type as "income" | "expense",
    })),
    entities: businesses.map((b) => ({ id: b.id, name: b.name, entityType: "business" as const })),
    investmentAccounts,
    knownTransferFitIds: new Set(
      transfersWithFitId.map((t) => t.externalId).filter((id): id is string => id !== null)
    ),
  };
}
