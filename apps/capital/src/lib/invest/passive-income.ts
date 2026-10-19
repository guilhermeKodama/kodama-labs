/**
 * Passive income (Renda passiva): which events count, where the money came
 * from, and how a month splits into stacked segments.
 *
 * Proventos is the label for FII income, dividends and JCP. Interest on a
 * business entity's caixinha is that company's financial income, not
 * personal passive income. Transfers, sales and redemptions are not income.
 * A value already stored in the base currency (`amountBase` / `grossBase`)
 * wins over converting the native amount at today's rate.
 */

const DAY = 86_400_000;
const AMOUNT = 0.01;

export const PASSIVE_INCOME_TYPES = ["fii_income", "dividend", "jcp", "fixed_income_interest"] as const;
export type PassiveIncomeType = (typeof PASSIVE_INCOME_TYPES)[number];
export type DividendOrigin = "BR" | "BDR" | "EXTERIOR";
export type IncomeBasis = "net" | "gross";
export type PassiveSeries = "none" | "incomeType" | "origin" | "allocationClass";

const INCOME_LABEL: Record<string, string> = {
  dividend: "Dividendo",
  jcp: "JCP",
  fii_income: "Rendimento FII",
  interest: "Juros",
  fixed_income_interest: "Juros",
};

/** Ledger label when the caller omits one: "Dividendo PETR4", or the holding name when it has no ticker. */
export function dividendDescription(incomeType: string, holding: { ticker: string | null; name: string }): string {
  return `${INCOME_LABEL[incomeType] ?? "Provento"} ${holding.ticker ?? holding.name}`;
}

/** The income type an asset class records when the caller does not name one. */
export function defaultIncomeType(assetClass: string): PassiveIncomeType {
  switch (assetClass) {
    case "fii":
      return "fii_income";
    case "fixed_income":
    case "savings":
      return "fixed_income_interest";
    default:
      return "dividend";
  }
}

/** Dividend origin implied by the listing. Null for assets that are not dividends. */
export function defaultDividendOrigin(assetClass: string, currency?: string | null): DividendOrigin | null {
  switch (assetClass) {
    case "bdr":
      return "BDR";
    case "international_stocks":
    case "international_etf":
      return "EXTERIOR";
    case "etf":
      return !currency || currency.toUpperCase() === "BRL" ? "BR" : "EXTERIOR";
    case "stocks":
      return "BR";
    default:
      return null;
  }
}

/** Interest realized inside a business entity stays in that company's books. */
export function countsAsPassiveIncome(row: { entityKind?: string | null; incomeType?: string | null }): boolean {
  return !(row.entityKind === "business" && (row.incomeType === "fixed_income_interest" || row.incomeType === "interest"));
}

export interface PassiveIdentity {
  holdingId?: string | null;
  ticker?: string | null;
  assetClass?: string | null;
  incomeType?: string | null;
  dividendOrigin?: string | null;
  allocationClass?: string | null;
}

/** Segment key when the chart groups by income type. Unlinked rows stay their own bucket. */
export function incomeTypeKey(row: PassiveIdentity): string {
  if (!row.holdingId && !row.incomeType) return "unlinked";
  if (row.incomeType === "interest" || row.incomeType === "fixed_income_interest") return "fixed_income_interest";
  if (row.incomeType === "fii_income" || row.incomeType === "dividend" || row.incomeType === "jcp") return row.incomeType;
  if (row.assetClass === "fii") return "fii_income";
  if (row.assetClass === "fixed_income" || row.assetClass === "savings") return "fixed_income_interest";
  return "dividend";
}

/**
 * Segment key when the chart groups by origin: each FII by ticker, then
 * Ações BR, BDR, Exterior, Renda fixa, and income that names no holding.
 */
export function originKey(row: PassiveIdentity): string {
  if (!row.holdingId) return "unlinked";
  if (row.incomeType === "fii_income" || row.assetClass === "fii") {
    const ticker = row.ticker?.trim();
    return ticker ? `fii:${ticker}` : "fii";
  }
  if (
    row.incomeType === "fixed_income_interest" ||
    row.incomeType === "interest" ||
    row.assetClass === "fixed_income" ||
    row.assetClass === "savings"
  ) {
    return "fixed_income";
  }
  if (row.dividendOrigin === "BDR" || row.assetClass === "bdr") return "bdr";
  if (row.dividendOrigin === "EXTERIOR" || row.assetClass === "international_stocks" || row.assetClass === "international_etf") return "exterior";
  if (row.dividendOrigin === "BR" || row.assetClass === "stocks" || row.assetClass === "etf") return "br_stocks";
  return "unlinked";
}

/** Class segment. Income with no holding is "Não vinculado", not the brokers' cash. */
export function allocationSeriesKey(row: PassiveIdentity): string {
  return row.allocationClass ?? "unlinked";
}

const TYPE_ORDER = ["fii_income", "dividend", "jcp", "fixed_income_interest", "unlinked"];
const ORIGIN_ORDER = ["br_stocks", "bdr", "exterior", "fixed_income", "unlinked"];
const CLASS_ORDER = ["fixed_income", "br_stocks", "fii", "international", "crypto", "cash", "unlinked"];

/** Stable series order. Origin puts each FII ticker first; a class chart keeps the portfolio's class order. */
export function sortSeriesKeys(keys: readonly string[], mode: PassiveSeries): string[] {
  const list = mode === "incomeType" ? TYPE_ORDER : mode === "allocationClass" ? CLASS_ORDER : ORIGIN_ORDER;
  const rank = (key: string): [number, string] => {
    if (mode === "origin" || mode === "none") {
      if (key.startsWith("fii:")) return [0, key];
      if (key === "fii") return [1, key];
    }
    const index = list.indexOf(key);
    return [index === -1 ? 40 : index + 2, key];
  };
  return [...keys].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1].localeCompare(rb[1]);
  });
}

export interface PassiveAmount {
  totalAmount: number;
  taxWithheld?: number;
  currency?: string | null;
  /** Net in the base currency, stored when the cash was booked. */
  amountBase?: number | null;
  /** Gross in the base currency. Falls back to scaling the stored net by gross/net. */
  grossBase?: number | null;
  taxBase?: number | null;
}

/**
 * What one event is worth in the base currency. A stored base amount is the
 * cash leg's `amountBase` (its exchange rate at booking); today's rate is
 * only the fallback for a row that never stored one.
 */
export function incomeBaseValue(row: PassiveAmount, basis: IncomeBasis, rateFor: (currency: string | null) => number): number {
  if (basis === "gross" && row.grossBase != null) return row.grossBase;
  if (basis === "net" && row.amountBase != null) return row.amountBase;
  const tax = row.taxWithheld ?? 0;
  const native = basis === "gross" ? row.totalAmount : row.totalAmount - tax;
  return native * rateFor(row.currency ?? null);
}

/** Withholding in the base currency: the stored tax, else gross − net when both are stored. */
export function incomeTaxBase(row: PassiveAmount, rateFor: (currency: string | null) => number): number {
  if (row.taxBase != null) return row.taxBase;
  if (row.grossBase != null && row.amountBase != null) return row.grossBase - row.amountBase;
  return (row.taxWithheld ?? 0) * rateFor(row.currency ?? null);
}

export interface PassiveOperationRef {
  id: string;
  at: number;
  netBase: number;
  grossBase: number;
  cashEntryId: string | null;
}

export interface PassiveLedgerRef {
  id: string;
  at: number;
  base: number;
  /** Transfer leg. Never income, even when a category says Proventos. */
  transfer: boolean;
}

/**
 * Ledger income that is not already counted: the operation's own cash leg,
 * or another row with the same base amount (net or gross, within R$ 0.01)
 * inside 7 days. One operation takes at most one ledger row. Transfers are
 * dropped and not returned.
 */
export function unmatchedPassiveIncome(operations: readonly PassiveOperationRef[], entries: readonly PassiveLedgerRef[]): string[] {
  const cashIds = new Set(operations.map((op) => op.cashEntryId).filter((id): id is string => !!id));
  const used = new Set<string>();
  const unmatched: string[] = [];
  const ops = [...operations].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  for (const entry of [...entries].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (entry.transfer || !(entry.base > 0) || cashIds.has(entry.id)) continue;
    let best: PassiveOperationRef | null = null;
    let bestGap = Infinity;
    for (const op of ops) {
      if (used.has(op.id)) continue;
      if (Math.abs(op.netBase - entry.base) > AMOUNT && Math.abs(op.grossBase - entry.base) > AMOUNT) continue;
      const gap = Math.abs(op.at - entry.at);
      if (gap > 7 * DAY) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = op;
      }
    }
    if (best) used.add(best.id);
    else unmatched.push(entry.id);
  }
  return unmatched;
}

export interface PassiveBarInput extends PassiveIdentity, PassiveAmount {
  date: string;
  entityKind?: string | null;
}

export interface PassiveMonth {
  month: string;
  total: number;
  tax: number;
  values: Record<string, number>;
  taxes: Record<string, number>;
}

export interface PassiveBars {
  months: string[];
  series: string[];
  rows: PassiveMonth[];
  total: number;
  tax: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function seriesKey(row: PassiveBarInput, series: PassiveSeries): string {
  if (series === "incomeType") return incomeTypeKey(row);
  if (series === "origin") return originKey(row);
  if (series === "allocationClass") return allocationSeriesKey(row);
  return "total";
}

/**
 * Monthly stacked bars. Months in the range are zero-filled. Business-entity
 * fixed-income interest is left out. `total` is the month (or the whole
 * window) in the chosen basis; `tax` is the withholding, in base currency.
 */
export function passiveIncomeBars(
  events: readonly PassiveBarInput[],
  opts: {
    from: string;
    to: string;
    series: PassiveSeries;
    basis: IncomeBasis;
    rateFor: (currency: string | null) => number;
  },
): PassiveBars {
  const months = monthsBetween(opts.from, opts.to);
  const index = new Map(months.map((month, i) => [month, i]));
  const rows: PassiveMonth[] = months.map((month) => ({ month, total: 0, tax: 0, values: {}, taxes: {} }));
  const seen = new Set<string>();
  let total = 0;
  let tax = 0;
  for (const event of events) {
    if (!countsAsPassiveIncome(event)) continue;
    const i = index.get(event.date.slice(0, 7));
    if (i === undefined) continue;
    const key = seriesKey(event, opts.series);
    const value = incomeBaseValue(event, opts.basis, opts.rateFor);
    const withheld = incomeTaxBase(event, opts.rateFor);
    const row = rows[i]!;
    row.values[key] = (row.values[key] ?? 0) + value;
    row.taxes[key] = (row.taxes[key] ?? 0) + withheld;
    row.total += value;
    row.tax += withheld;
    total += value;
    tax += withheld;
    seen.add(key);
  }
  return {
    months,
    series: sortSeriesKeys([...seen], opts.series),
    rows,
    total,
    tax,
  };
}
