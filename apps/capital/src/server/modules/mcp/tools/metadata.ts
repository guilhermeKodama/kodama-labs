import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { listCategories } from "../../categories/services/categories";

/** Categories, optionally by type, with how many live entries use each. */
export async function listCategoriesForMcp(userId: string, type: TransactionType | undefined, db: DbClient, includeArchived = false) {
  const categories = await listCategories(userId, db, { type, includeArchived });
  const counts = await db.ledgerEntry.groupBy({
    by: ["categoryId"],
    where: { userId, deletedAt: null, categoryId: { in: categories.map((c) => c.id) } },
    _count: { id: true },
  });
  const countMap = new Map(counts.map((c) => [c.categoryId, c._count.id]));
  return {
    categories: categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      color: cat.color,
      icon: cat.icon,
      isDefault: cat.isDefault,
      isSystem: cat.isSystem,
      systemKey: cat.systemKey,
      isArchived: cat.isArchived,
      transactionCount: countMap.get(cat.id) ?? 0,
    })),
  };
}

/**
 * Entities that can receive transactions, each with its ledger accounts.
 * Entity ids are the businessId / personalAccountId the other tools take.
 * Account ids are the accountId bulk_create_transactions and the update
 * tools take. Archived accounts are hidden unless includeArchived is set;
 * every returned account carries archived.
 */
export async function listAccounts(userId: string, db: DbClient, opts: { includeArchived?: boolean } = {}) {
  const entities = await db.entity.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "asc" } });
  const accounts = entities.length
    ? await db.account.findMany({
        where: { userId, entityId: { in: entities.map((entity) => entity.id) }, ...(opts.includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      })
    : [];
  const byEntity = new Map<string, typeof accounts>();
  for (const account of accounts) {
    const rows = byEntity.get(account.entityId) ?? [];
    rows.push(account);
    byEntity.set(account.entityId, rows);
  }
  const rowsOf = (entityId: string) =>
    (byEntity.get(entityId) ?? []).map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      isDefault: account.isDefault,
      archived: account.archivedAt !== null,
    }));
  const personal = entities.find((e) => e.kind === "personal");
  return {
    businesses: entities
      .filter((e) => e.kind === "business")
      .map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        defaultCurrency: b.defaultCurrency,
        color: b.color,
        entityType: "business" as const,
        accounts: rowsOf(b.id),
      })),
    personalAccount: personal
      ? { id: personal.id, name: "Personal", defaultCurrency: personal.defaultCurrency, entityType: "personal" as const, accounts: rowsOf(personal.id) }
      : null,
  };
}

/** Valid transaction types. */
export function getValidTypes() {
  return { types: ["income", "expense", "investment"] };
}
