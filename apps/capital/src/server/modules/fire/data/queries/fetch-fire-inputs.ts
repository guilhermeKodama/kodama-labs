import type { DbClient } from "@capital/server/lib/prisma";
import { getUserToday } from "@capital/server/lib/date-utils";

export interface FireInputHolding {
  currentQuantity: number;
  currentPrice: number | null;
  totalInvested: number;
  currency: string;
  entityType: string;
}
export interface FireInputSpend {
  amount: number;
  exchangeRate: number;
  category: string | null;
  date: Date;
}

export interface FireInputs {
  baseCurrency: string;
  timezone: string;
  holdings: FireInputHolding[];
  /** Currency code -> base-currency per unit (derived from each currency's manualRate). */
  currencyRates: Record<string, number>;
  expenses: FireInputSpend[];
  contributions: FireInputSpend[];
  income: FireInputSpend[];
}

/**
 * Everything the FIRE engine needs about the user's actual finances: the
 * investment portfolio + cash (the FIRE base), and the trailing window of
 * expenses (for the gap) and investment outflows (for the suggested contribution).
 */
export async function fetchFireInputs(
  userId: string,
  db: DbClient,
  opts: { trailingMonths: number }
): Promise<FireInputs> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { baseCurrency: true, timezone: true },
  });
  const baseCurrency = user?.baseCurrency ?? "BRL";
  const timezone = user?.timezone ?? "America/Sao_Paulo";

  const now = getUserToday(timezone);
  const start = new Date(now);
  start.setMonth(start.getMonth() - opts.trailingMonths);

  const ownership = { OR: [{ business: { userId } }, { personalAccount: { userId } }] };

  const [holdings, currencies, expenses, contributions, income] = await Promise.all([
    db.investmentHolding.findMany({
      where: { account: { userId }, isActive: true },
      select: {
        currentQuantity: true,
        currentPrice: true,
        totalInvested: true,
        currency: true,
        account: { select: { entityType: true } },
      },
    }),
    db.currency.findMany({ where: { userId }, select: { code: true, manualRate: true } }),
    db.transaction.findMany({
      where: { type: "expense", date: { gte: start }, ...ownership },
      select: { amount: true, exchangeRate: true, category: true, date: true },
    }),
    db.transaction.findMany({
      where: { type: "investment", date: { gte: start }, ...ownership },
      select: { amount: true, exchangeRate: true, category: true, date: true },
    }),
    db.transaction.findMany({
      where: { type: "income", date: { gte: start }, ...ownership },
      select: { amount: true, exchangeRate: true, category: true, date: true },
    }),
  ]);

  // manualRate means "1 base = X this currency", so base-per-unit = 1 / manualRate.
  // The base currency is ALWAYS 1 — never let a stray base-currency row (e.g. a
  // BRL row whose manualRate was set to the USD price) override it and deflate
  // base-currency holdings.
  const currencyRates: Record<string, number> = { [baseCurrency]: 1 };
  for (const c of currencies) {
    if (c.code === baseCurrency) continue;
    if (c.manualRate > 0) currencyRates[c.code] = 1 / c.manualRate;
  }

  const mappedHoldings: FireInputHolding[] = holdings.map((h) => ({
    currentQuantity: h.currentQuantity,
    currentPrice: h.currentPrice,
    totalInvested: h.totalInvested,
    currency: h.currency,
    entityType: h.account.entityType,
  }));

  return {
    baseCurrency,
    timezone,
    holdings: mappedHoldings,
    currencyRates,
    expenses,
    contributions,
    income,
  };
}
