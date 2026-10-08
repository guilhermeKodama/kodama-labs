import type { DbClient } from "@capital/server/lib/prisma";
import { fetchEcbQuotes, fetchPtaxQuote, type FetchLike, type FxQuote } from "../lib/fx-providers";
import { autoSourceFor } from "../lib/fx-source";

export interface UpdateRatesResult {
  usersProcessed: number;
  /** Rows whose rate, source or quote time changed. */
  ratesUpdated: number;
  /** Rows already holding the latest quote. */
  ratesUnchanged: number;
  /** Rows the user set by hand (source "manual"), which the refresh leaves alone. */
  manualSkipped: number;
  /** Provider calls that failed (one per PTAX currency or ECB base). */
  errors: number;
}

export interface UpdateRatesOptions {
  now?: Date;
  fetch?: FetchLike;
  /** Refresh only these users' currencies. */
  userIds?: string[];
}

/** Same rate as far as a Float column can tell. */
const sameRate = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-12;

/**
 * Refreshes the automatic currency rates of every user with fxAutoUpdate
 * on (or of the given users): PTAX (BCB) for the currencies it quotes on a BRL
 * base, the ECB's reference rates (Frankfurter) for everything else. Rates
 * the user typed (source "manual") and the base currency itself are never
 * touched. A row is written only when its quote changed, so `rateUpdatedAt`
 * is when the rate in force was published, and the hourly cron is a no-op
 * between publications.
 */
export async function updateAllCurrencyRates(db: DbClient, opts: UpdateRatesOptions = {}): Promise<UpdateRatesResult> {
  const now = opts.now ?? new Date();
  const fetcher: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const result: UpdateRatesResult = { usersProcessed: 0, ratesUpdated: 0, ratesUnchanged: 0, manualSkipped: 0, errors: 0 };

  const users = await db.user.findMany({
    where: { fxAutoUpdate: true, ...(opts.userIds && { id: { in: opts.userIds } }) },
    select: {
      id: true,
      baseCurrency: true,
      currencies: { select: { id: true, code: true, manualRate: true, source: true, rateUpdatedAt: true } },
    },
  });

  // What to fetch: PTAX per currency (it is quoted against BRL only), ECB per base currency.
  const ptaxCodes = new Set<string>();
  const ecbCodesByBase = new Map<string, Set<string>>();
  for (const user of users) {
    for (const c of user.currencies) {
      if (c.code === user.baseCurrency) continue;
      if (c.source === "manual") {
        result.manualSkipped++;
        continue;
      }
      if (autoSourceFor(user.baseCurrency, c.code) === "ptax") ptaxCodes.add(c.code);
      else ecbCodesByBase.set(user.baseCurrency, (ecbCodesByBase.get(user.baseCurrency) ?? new Set<string>()).add(c.code));
    }
  }

  const quotes = new Map<string, FxQuote>(); // `${base}:${code}`
  for (const code of ptaxCodes) {
    try {
      quotes.set(`BRL:${code}`, await fetchPtaxQuote(code, now, fetcher));
    } catch (error) {
      console.error(`[RateUpdate] ${error instanceof Error ? error.message : String(error)}`);
      result.errors++;
    }
  }
  for (const [base, codes] of ecbCodesByBase) {
    try {
      for (const quote of await fetchEcbQuotes(base, [...codes], fetcher)) quotes.set(`${base}:${quote.code}`, quote);
    } catch (error) {
      console.error(`[RateUpdate] ${error instanceof Error ? error.message : String(error)}`);
      result.errors++;
    }
  }

  // Append the PTAX close for the day. A failed fetch never reaches here, and a
  // write failure is counted and left for the next run; stored days stay.
  for (const [key, quote] of quotes) {
    if (!key.startsWith("BRL:") || quote.source !== "ptax" || !(quote.manualRate > 0)) continue;
    try {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(quote.quotedAt);
      const date = new Date(`${day}T00:00:00.000Z`);
      await db.currencyRateDay.upsert({
        where: { code_date: { code: quote.code, date } },
        create: { code: quote.code, date, brlPerUnit: 1 / quote.manualRate, source: "ptax" },
        update: { brlPerUnit: 1 / quote.manualRate, source: "ptax" },
      });
    } catch (error) {
      console.error(`[RateUpdate] ${error instanceof Error ? error.message : String(error)}`);
      result.errors++;
    }
  }

  for (const user of users) {
    for (const c of user.currencies) {
      if (c.code === user.baseCurrency || c.source === "manual") continue;
      const quote = quotes.get(`${user.baseCurrency}:${c.code}`);
      if (!quote) continue;
      if (c.source === quote.source && sameRate(c.manualRate, quote.manualRate) && c.rateUpdatedAt?.getTime() === quote.quotedAt.getTime()) {
        result.ratesUnchanged++;
        continue;
      }
      // Guarded on source, so a rate the user typed since the read above is kept.
      const { count } = await db.currency.updateMany({
        where: { id: c.id, source: { not: "manual" } },
        data: { manualRate: quote.manualRate, source: quote.source, rateUpdatedAt: quote.quotedAt },
      });
      result.ratesUpdated += count;
    }
    result.usersProcessed++;
  }

  return result;
}
