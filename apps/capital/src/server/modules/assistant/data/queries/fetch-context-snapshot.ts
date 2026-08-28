import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Everything the agent needs to orient itself at the start of a
 * conversation: entities, categories, cards, investment accounts,
 * currencies, recent import history and learned merchant→category
 * mappings. Kept small (a few thousand tokens) - this is meant to be
 * called once per turn, not per row.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchContextSnapshot(userId: string, db: DbClient) {
  const [
    user,
    businesses,
    personalAccount,
    categories,
    creditCards,
    investmentAccounts,
    currencies,
    recentImports,
    merchantCategoryMappings,
  ] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { baseCurrency: true, timezone: true },
    }),
    db.business.findMany({
      where: { userId },
      select: { id: true, name: true, defaultCurrency: true },
    }),
    db.personalAccount.findUnique({
      where: { userId },
      select: { id: true, defaultCurrency: true },
    }),
    db.category.findMany({
      where: { userId },
      select: { name: true, type: true, isSystem: true },
      orderBy: { name: "asc" },
    }),
    db.creditCard.findMany({
      where: {
        OR: [{ business: { userId } }, { personalAccount: { userId } }],
      },
      select: {
        id: true,
        bankName: true,
        lastFourDigits: true,
        entityType: true,
        businessId: true,
        personalAccountId: true,
        closingDay: true,
        dueDay: true,
      },
    }),
    db.investmentAccount.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        broker: true,
        entityType: true,
        currency: true,
        businessId: true,
        personalAccountId: true,
        isActive: true,
        _count: { select: { holdings: true } },
      },
    }),
    db.currency.findMany({
      where: { userId },
      select: { code: true, manualRate: true },
    }),
    db.statementImport.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        bankName: true,
        entityType: true,
        transactionCount: true,
        source: true,
        createdAt: true,
      },
    }),
    // Capped and most-recently-touched-first: this can grow unboundedly
    // over the life of an account, and the point is covering typical
    // recurring merchants, not being an exhaustive dump.
    db.merchantCategoryMapping.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { normalizedDescription: true, category: true },
    }),
  ]);

  return {
    baseCurrency: user.baseCurrency,
    timezone: user.timezone,
    businesses,
    personalAccount,
    categories,
    creditCards,
    investmentAccounts,
    currencies,
    recentImports,
    merchantCategoryMappings,
  };
}
