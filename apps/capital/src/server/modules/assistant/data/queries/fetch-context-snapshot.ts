import type { DbClient } from "@capital/server/lib/prisma";
import { legacyEntityRef } from "@capital/server/modules/ledger/services/entities";

/**
 * Everything the agent needs to orient itself at the start of a
 * conversation: entities, categories, cards, investment accounts,
 * currencies, recent import history and learned categorization rules.
 * Kept small (a few thousand tokens) - this is meant to be called once
 * per turn, not per row.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchContextSnapshot(userId: string, db: DbClient) {
  const [user, entities, categories, accounts, currencies, recentImports, rules] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true, timezone: true } }),
    db.entity.findMany({ where: { userId, archivedAt: null }, select: { id: true, kind: true, name: true, defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
    db.category.findMany({ where: { userId, isArchived: false }, select: { name: true, type: true, isSystem: true }, orderBy: { name: "asc" } }),
    db.account.findMany({
      where: { userId, type: { in: ["credit_card", "brokerage"] } },
      include: { entity: { select: { id: true, kind: true } }, _count: { select: { holdings: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.currency.findMany({ where: { userId }, select: { code: true, manualRate: true } }),
    db.import.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, bankName: true, transactionCount: true, source: true, createdAt: true, entity: { select: { kind: true } } },
    }),
    // Capped and most-recently-touched-first: the point is covering typical
    // recurring merchants, not an exhaustive dump.
    db.categorizationRule.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { pattern: true, matchType: true, category: { select: { name: true } } },
    }),
  ]);

  const personal = entities.find((e) => e.kind === "personal");
  return {
    baseCurrency: user.baseCurrency,
    timezone: user.timezone,
    businesses: entities.filter((e) => e.kind === "business").map((e) => ({ id: e.id, name: e.name, defaultCurrency: e.defaultCurrency })),
    personalAccount: personal ? { id: personal.id, defaultCurrency: personal.defaultCurrency } : null,
    categories,
    creditCards: accounts
      .filter((a) => a.type === "credit_card")
      .map((c) => ({ id: c.id, bankName: c.institution ?? c.name, lastFourDigits: c.externalId, ...legacyEntityRef(c.entity), closingDay: c.closingDay, dueDay: c.dueDay, isActive: c.archivedAt === null })),
    investmentAccounts: accounts
      .filter((a) => a.type === "brokerage")
      .map((a) => ({ id: a.id, name: a.name, broker: a.institution, currency: a.currency, ...legacyEntityRef(a.entity), isActive: a.archivedAt === null, _count: a._count })),
    currencies,
    recentImports: recentImports.map((i) => ({ id: i.id, bankName: i.bankName, entityType: i.entity?.kind ?? null, transactionCount: i.transactionCount, source: i.source, createdAt: i.createdAt })),
    categorizationRules: rules.map((r) => ({ pattern: r.pattern, matchType: r.matchType, category: r.category.name })),
  };
}
