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
 * Entities that can receive transactions: the businesses and the personal
 * entity. Their ids are the businessId / personalAccountId the other tools take.
 */
export async function listAccounts(userId: string, db: DbClient) {
  const entities = await db.entity.findMany({ where: { userId, archivedAt: null }, orderBy: { createdAt: "asc" } });
  const personal = entities.find((e) => e.kind === "personal");
  return {
    businesses: entities
      .filter((e) => e.kind === "business")
      .map((b) => ({ id: b.id, name: b.name, description: b.description, defaultCurrency: b.defaultCurrency, color: b.color, entityType: "business" as const })),
    personalAccount: personal ? { id: personal.id, name: "Personal", defaultCurrency: personal.defaultCurrency, entityType: "personal" as const } : null,
  };
}

/** Valid transaction types. */
export function getValidTypes() {
  return { types: ["income", "expense", "investment"] };
}
