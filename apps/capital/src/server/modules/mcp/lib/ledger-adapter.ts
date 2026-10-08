import { Prisma, type Category, type Entity, type LedgerEntry, type TransactionType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { legacyEntityRef } from "@capital/server/modules/ledger/services/entities";
import { displayAmount, toNumber } from "@capital/server/modules/ledger/lib/money";
import { formatCategoryValidationError, matchCategoryName } from "./category-validation";

/**
 * The MCP contract predates the ledger: a "transaction" has a `type`, a
 * category name and a businessId/personalAccountId. Amounts are signed the
 * way the ledger shows them: a charge is a positive expense, a refund or
 * reversal is a negative expense.
 */

export const LEGACY_ENTRY_INCLUDE = {
  category: { select: { name: true } },
  entity: { select: { id: true, kind: true } },
  transferGroup: { select: { id: true, legs: { select: { id: true, amount: true, currency: true } } } },
} satisfies Prisma.LedgerEntryInclude;

type LegacyEntry = LedgerEntry & {
  category: Pick<Category, "name"> | null;
  entity: Pick<Entity, "id" | "kind">;
  transferGroup?: { id: string; legs: { id: string; amount: Prisma.Decimal; currency: string }[] } | null;
};

export function legacyType(entry: Pick<LedgerEntry, "kind" | "amount">): TransactionType {
  if (entry.kind === "transfer") return toNumber(entry.amount) >= 0 ? "income" : "expense";
  return entry.kind;
}

export function toLegacyTransaction(e: LegacyEntry) {
  const ref = legacyEntityRef(e.entity);
  return {
    id: e.id,
    entityType: ref.entityType,
    type: legacyType(e),
    amount: displayAmount(e.kind, e.amount),
    currency: e.currency,
    exchangeRate: toNumber(e.exchangeRate),
    description: e.description,
    category: e.category?.name ?? null,
    date: e.date.toISOString(),
    isTaxDeductible: e.isTaxDeductible,
    businessId: ref.businessId,
    personalAccountId: ref.personalAccountId,
    accountId: e.accountId,
    createdAt: e.createdAt.toISOString(),
    /** Set on a transfer leg: the pair, and the other leg's signed amount and currency. */
    transferGroupId: e.transferGroupId,
    counterpartAmount: counterpartAmount(e),
    counterpartCurrency: counterpartCurrency(e),
  };
}

function counterpartLeg(e: LegacyEntry) {
  return e.transferGroup?.legs.find((leg) => leg.id !== e.id) ?? null;
}

function counterpartAmount(e: LegacyEntry): number | null {
  const other = counterpartLeg(e);
  return other ? toNumber(other.amount) : null;
}

function counterpartCurrency(e: LegacyEntry): string | null {
  return counterpartLeg(e)?.currency ?? null;
}

/** Category loader for a batch: resolves names (exact, then case-insensitive) to ids with the MCP error messages. */
export async function categoryResolver(userId: string, db: DbClient) {
  const categories = await db.category.findMany({ where: { userId }, select: { id: true, name: true, type: true, isArchived: true } });
  return {
    categories,
    /** Throws on unknown or archived names, unless the archived one is `currentId` (an update keeping its category). */
    resolve(name: string, type: TransactionType | undefined, currentId?: string | null) {
      const match = matchCategoryName(name, categories, type);
      const row = match.canonicalName ? categories.find((c) => c.name === match.canonicalName && (!type || c.type === type)) : undefined;
      if (row && (match.valid || row.id === currentId)) return row;
      throw new Error(formatCategoryValidationError(name, type, match));
    },
    nameOf(id: string | null) {
      return id ? categories.find((c) => c.id === id)?.name ?? null : null;
    },
  };
}
