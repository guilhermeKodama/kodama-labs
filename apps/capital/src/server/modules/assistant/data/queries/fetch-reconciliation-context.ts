import type { DbClient } from "@capital/server/lib/prisma";
import type {
  ExistingTransactionData,
  EntityInfo,
  InvestmentAccountInfo,
} from "@capital/server/modules/bank-statements/services/reconciliation";

/**
 * The context both statement imports (v2 analyze route and the assistant's
 * reconcile_statement) match against: every bank-account entry across ALL
 * entities, so a row the user typed under the wrong entity is still found;
 * the user's businesses and brokerages for classification; and the
 * external ids of transfers already imported.
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
  const [entries, businesses, brokerages, transfers] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { userId, deletedAt: null, transferGroupId: null, kind: { in: ["income", "expense"] }, account: { type: { in: ["checking", "cash"] } } },
      select: { id: true, externalId: true, amount: true, date: true, description: true, kind: true },
    }),
    db.entity.findMany({ where: { userId, kind: "business", archivedAt: null }, select: { id: true, name: true } }),
    db.account.findMany({ where: { userId, type: "brokerage", archivedAt: null }, select: { id: true, name: true } }),
    db.transferGroup.findMany({ where: { userId, externalId: { not: null }, deletedAt: null }, select: { externalId: true } }),
  ]);

  return {
    existingTransactions: entries.map((e) => ({
      id: e.id,
      externalId: e.externalId,
      amount: Math.abs(Number(e.amount)),
      date: e.date,
      description: e.description,
      type: e.kind as "income" | "expense",
    })),
    entities: businesses.map((b) => ({ id: b.id, name: b.name, entityType: "business" as const })),
    investmentAccounts: brokerages,
    knownTransferFitIds: new Set(transfers.map((t) => t.externalId).filter((id): id is string => id !== null)),
  };
}
