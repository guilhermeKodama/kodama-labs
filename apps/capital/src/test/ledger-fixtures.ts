import type { PrismaClient } from "@/generated/prisma";

export interface LedgerFixture {
  userId: string;
  pfId: string;
  pjId: string;
  pfChecking: string;
  pjChecking: string;
  card: string;
  broker: string;
  categories: Record<string, string>;
}

/**
 * Creates a user with a PF and a business entity, their default checking
 * accounts, a credit card (closes on the 5th, due on the 12th) and a broker.
 * Deleting the user cascades every ledger row, so cleanup is one call.
 */
export async function createLedgerFixture(
  db: PrismaClient,
  userId: string,
  opts: { baseCurrency?: string; usdRate?: number; categories?: { name: string; type: "income" | "expense" | "investment" }[] } = {}
): Promise<LedgerFixture> {
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({
    data: { id: userId, email: `${userId}@example.com`, passwordHash: "x", name: userId, baseCurrency: opts.baseCurrency ?? "BRL" },
  });
  if (opts.usdRate) {
    await db.currency.create({ data: { userId, code: "USD", name: "US Dollar", symbol: "$", manualRate: opts.usdRate } });
  }
  const pf = await db.entity.create({ data: { userId, kind: "personal", name: "PF", defaultCurrency: "BRL" } });
  const pj = await db.entity.create({ data: { userId, kind: "business", name: "Kodama LTDA", defaultCurrency: "BRL" } });
  const pfChecking = await db.account.create({
    data: { userId, entityId: pf.id, type: "checking", name: "Conta principal", currency: "BRL", isDefault: true },
  });
  const pjChecking = await db.account.create({
    data: { userId, entityId: pj.id, type: "checking", name: "Conta principal", currency: "BRL", isDefault: true },
  });
  const card = await db.account.create({
    data: {
      userId,
      entityId: pf.id,
      type: "credit_card",
      name: "Nubank",
      currency: "BRL",
      externalId: "1234",
      creditLimit: 10000,
      closingDay: 5,
      dueDay: 12,
      payFromAccountId: pfChecking.id,
    },
  });
  const broker = await db.account.create({
    data: { userId, entityId: pf.id, type: "brokerage", name: "XP", currency: "BRL" },
  });
  const categories: Record<string, string> = {};
  for (const c of opts.categories ?? [
    { name: "Groceries", type: "expense" },
    { name: "Software", type: "expense" },
    { name: "Salary", type: "income" },
  ]) {
    const row = await db.category.create({ data: { userId, name: c.name, type: c.type } });
    categories[c.name] = row.id;
  }
  return {
    userId,
    pfId: pf.id,
    pjId: pj.id,
    pfChecking: pfChecking.id,
    pjChecking: pjChecking.id,
    card: card.id,
    broker: broker.id,
    categories,
  };
}

export async function deleteLedgerFixture(db: PrismaClient, userId: string) {
  await db.user.deleteMany({ where: { id: userId } });
}
