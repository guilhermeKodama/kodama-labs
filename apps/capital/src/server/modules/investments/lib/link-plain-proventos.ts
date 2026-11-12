import { incomeCashBucket, type IncomeCashBucket } from "@capital/server/modules/ledger/lib/income-cash-category";

/**
 * Plans convert_income_to_dividend calls for plain income already filed as
 * Proventos (or the dividends / interest system category) and not yet a
 * cash leg. It never creates a second credit: the existing entry is the
 * leg. Review the plan, then pass it to convertIncomeToDividend.
 *
 * A ticker is the first Brazilian-style code in the description
 * (HGLG11, PETR4). The holding is the one on the same account when that
 * matches, otherwise the only holding of that ticker in the entry's entity.
 * Income type: Rendimentos (name or system key interest) is
 * fixed_income_interest; a ticker ending in 11 is fii_income; anything
 * else is a dividend. That guess is what the dry run is for.
 */

const TICKER = /\b([A-Za-z]{4}\d{1,2})\b/;

export interface PlainProventoIncome {
  id: string;
  description: string;
  entityId: string;
  accountId: string;
  categoryName: string | null;
  categorySystemKey: string | null;
  /** Stored ledger amount. Must be positive; a transfer is not a candidate. */
  amount: number;
  date: string;
}

export interface PlainProventoHolding {
  id: string;
  ticker: string | null;
  entityId: string;
  accountId: string;
  name: string;
}

export interface PlannedProventoLink {
  transactionId: string;
  holdingId: string;
  ticker: string;
  incomeType: "fii_income" | "dividend" | "fixed_income_interest";
  date: string;
  amount: number;
  description: string;
}

export type SkippedProventoLink = { transactionId: string; description: string; reason: string };

export function tickerInDescription(description: string): string | null {
  const match = TICKER.exec(description);
  return match ? match[1].toUpperCase() : null;
}

export function incomeTypeForPlainProvento(row: Pick<PlainProventoIncome, "categoryName" | "categorySystemKey">, ticker: string): PlannedProventoLink["incomeType"] {
  const name = row.categoryName?.trim().toLowerCase() ?? "";
  if (row.categorySystemKey === "interest" || name === "rendimentos") return "fixed_income_interest";
  if (ticker.endsWith("11")) return "fii_income";
  return "dividend";
}

/** True when this income is the plain-provento bucket the linker is allowed to attach. */
export function isPlainProventoCategory(row: Pick<PlainProventoIncome, "categoryName" | "categorySystemKey">): boolean {
  const name = row.categoryName?.trim().toLowerCase() ?? "";
  return name === "proventos" || name === "rendimentos" || row.categorySystemKey === "dividends" || row.categorySystemKey === "interest";
}

export function planPlainProventoLinks(
  incomes: readonly PlainProventoIncome[],
  holdings: readonly PlainProventoHolding[],
): { links: PlannedProventoLink[]; skipped: SkippedProventoLink[] } {
  const links: PlannedProventoLink[] = [];
  const skipped: SkippedProventoLink[] = [];
  for (const income of incomes) {
    if (!(income.amount > 0)) {
      skipped.push({ transactionId: income.id, description: income.description, reason: "amount is not a credit" });
      continue;
    }
    if (!isPlainProventoCategory(income)) {
      skipped.push({ transactionId: income.id, description: income.description, reason: "category is not Proventos or Rendimentos" });
      continue;
    }
    const ticker = tickerInDescription(income.description);
    if (!ticker) {
      skipped.push({ transactionId: income.id, description: income.description, reason: "no ticker in the description" });
      continue;
    }
    const same = holdings.filter((h) => h.ticker?.toUpperCase() === ticker && h.entityId === income.entityId);
    const onAccount = same.filter((h) => h.accountId === income.accountId);
    const holding = onAccount.length === 1 ? onAccount[0] : same.length === 1 ? same[0] : null;
    if (!holding) {
      const reason = same.length === 0 ? `no holding ${ticker} in this entity` : `more than one holding ${ticker} in this entity`;
      skipped.push({ transactionId: income.id, description: income.description, reason });
      continue;
    }
    const incomeType = incomeTypeForPlainProvento(income, ticker);
    // fixed_income_interest is a yield; the others are dividends. The bucket
    // check documents that the guess is one convert_income_to_dividend accepts.
    const bucket: IncomeCashBucket | null = incomeCashBucket(incomeType, incomeType === "fixed_income_interest" ? "yield_payment" : "dividend");
    if (!bucket) {
      skipped.push({ transactionId: income.id, description: income.description, reason: "could not choose an income type" });
      continue;
    }
    links.push({
      transactionId: income.id,
      holdingId: holding.id,
      ticker,
      incomeType,
      date: income.date,
      amount: income.amount,
      description: income.description,
    });
  }
  return { links, skipped };
}
