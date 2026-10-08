import type { DbClient } from "@capital/server/lib/prisma";
import { toNumber } from "./money";
import { LedgerError } from "./errors";

export interface FxContext {
  baseCurrency: string;
  /** Base-currency units per 1 unit of `currency` (1 for the base currency). Today's rate. */
  rateFor(currency: string): number;
  /** A positive rate is stored for `currency` (the base currency always counts). The fallback of 1 does not. */
  hasRate(currency: string): boolean;
  /**
   * Base-currency units per 1 unit of `currency` on `date`: the latest stored
   * close strictly before that UTC day (the previous business day; PTAX
   * publishes after noon UTC and ledger dates are noon UTC). Falls back to
   * today's rate when no earlier close is stored, or when the base is not BRL.
   */
  rateOn(currency: string, date: Date): number;
}

export interface RateClose {
  day: string;
  brlPerUnit: number;
}

/**
 * The latest close strictly before `day` ("YYYY-MM-DD"). `closes` is sorted
 * ascending by day. Null when every close is on or after `day`.
 */
export function previousBusinessDayClose(closes: readonly RateClose[], day: string): RateClose | null {
  let best: RateClose | null = null;
  for (const row of closes) {
    if (row.day < day) best = row;
    else break;
  }
  return best;
}

/** `previousBusinessDayClose` as a rate, or null when no earlier close exists. */
export function previousBusinessDayRate(closes: readonly RateClose[], day: string): number | null {
  return previousBusinessDayClose(closes, day)?.brlPerUnit ?? null;
}

/**
 * Rates come from the user's currencies table, where `manualRate` means
 * "1 base = X foreign", so the stored entry rate is its inverse. A missing
 * or non-positive rate falls back to 1, matching the pre-ledger behavior.
 * Dated rates come from currency_rate_days (BRL per unit).
 */
export async function loadFx(userId: string, db: DbClient): Promise<FxContext> {
  const [user, currencies, history] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }),
    db.currency.findMany({ where: { userId }, select: { code: true, manualRate: true } }),
    db.currencyRateDay.findMany({ select: { code: true, date: true, brlPerUnit: true }, orderBy: { date: "asc" } }),
  ]);
  if (!user) throw new LedgerError("User not found", 404, { code: "user.not_found" });
  const rates = new Map(currencies.map((c) => [c.code, c.manualRate]));
  const closes = new Map<string, RateClose[]>();
  for (const row of history) {
    const list = closes.get(row.code) ?? [];
    list.push({ day: row.date.toISOString().slice(0, 10), brlPerUnit: toNumber(row.brlPerUnit) });
    closes.set(row.code, list);
  }
  const rateFor = (currency: string) => {
    if (currency === user.baseCurrency) return 1;
    const manual = rates.get(currency);
    return manual && manual > 0 ? 1 / manual : 1;
  };
  const hasRate = (currency: string) => currency === user.baseCurrency || (rates.get(currency) ?? 0) > 0;
  return {
    baseCurrency: user.baseCurrency,
    rateFor,
    hasRate,
    rateOn(currency: string, date: Date) {
      if (currency === user.baseCurrency) return 1;
      if (user.baseCurrency !== "BRL") return rateFor(currency);
      const day = date.toISOString().slice(0, 10);
      const historical = previousBusinessDayRate(closes.get(currency) ?? [], day);
      return historical ?? rateFor(currency);
    },
  };
}
