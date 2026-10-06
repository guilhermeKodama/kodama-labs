import type { Category, Entity, LedgerEntry, Prisma, TransactionType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { legacyEntityRef } from "@capital/server/modules/ledger/services/entities";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { formatCategoryValidationError, matchCategoryName } from "./category-validation";

/**
 * The MCP contract predates the ledger: a "transaction" has a positive
 * amount, a `type`, a category name and a businessId/personalAccountId.
 * This file maps ledger entries to and from that shape.
 */

export const LEGACY_ENTRY_INCLUDE = {
  category: { select: { name: true } },
  entity: { select: { id: true, kind: true } },
} satisfies Prisma.LedgerEntryInclude;

type LegacyEntry = LedgerEntry & { category: Pick<Category, "name"> | null; entity: Pick<Entity, "id" | "kind"> };

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
    amount: Math.abs(toNumber(e.amount)),
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
  };
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
