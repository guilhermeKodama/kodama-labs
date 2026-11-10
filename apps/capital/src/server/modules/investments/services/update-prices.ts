import type { DbClient } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { fetchQuotesDetailed, quoteRequestKey, type Quote, type QuoteAttempt, type QuoteOutcome, type QuoteRequest } from "../lib/quotes";

/** Why a holding did not get a fresh price this run. */
export type PriceUpdateReason = QuoteOutcome | "no_ticker" | "currency_mismatch" | "write_failed";

export interface HoldingPriceIssue {
  holdingId: string;
  ticker: string | null;
  reason: PriceUpdateReason;
  /** currency_mismatch only: what the provider actually quoted (so this never gets applied in the wrong currency). */
  quotedCurrency?: string;
}

export interface PriceUpdateResult {
  totalHoldings: number;
  updated: number;
  /** Holdings whose price could not be written. */
  failed: number;
  /** Tickers no source returned a usable price for. */
  missing: string[];
  bySource: {
    coingecko: number;
    brapi: number;
    yahoo: number;
  };
  /** One entry per holding that did not get a fresh price this run, with why. */
  issues: HoldingPriceIssue[];
  /** The newest `asOf` among the quotes actually applied, in ISO; null if none were. Lets a cron tell "the market is closed" from "the source is broken". */
  latestQuoteAt: string | null;
}

/**
 * Fetches the current price of every active holding (one user's with
 * `userId`) and stores it with the time of the update. Crypto is priced in
 * its holding's currency, B3 tickers on brapi.dev (Yahoo ".SA" as fallback)
 * and the rest on Yahoo Finance (see lib/quotes.ts).
 *
 * A holding with no ticker, with an asset class no source prices yet
 * (fixed income, savings), or whose quote came back in the wrong currency,
 * is reported in `issues` instead of silently left out of the count: see
 * CLAUDE.md / the F0 plan for why "0 updated, success: true" used to hide
 * a broken portfolio.
 */
export async function updateAllPrices(db: DbClient, opts: { userId?: string } = {}): Promise<PriceUpdateResult> {
  const result: PriceUpdateResult = {
    totalHoldings: 0,
    updated: 0,
    failed: 0,
    missing: [],
    bySource: { coingecko: 0, brapi: 0, yahoo: 0 },
    issues: [],
    latestQuoteAt: null,
  };

  const holdings = await db.investmentHolding.findMany({
    where: { isActive: true, ...(opts.userId && { account: { userId: opts.userId } }) },
    select: { id: true, ticker: true, assetClass: true, currency: true },
  });
  result.totalHoldings = holdings.length;
  if (!holdings.length) return result;

  // One request per ticker; crypto per ticker and currency (priced in the holding's currency).
  const requests = new Map<string, QuoteRequest & { holdingIds: { id: string; currency: string }[] }>();
  for (const h of holdings) {
    const ticker = h.ticker?.trim().toUpperCase();
    if (!ticker) {
      result.issues.push({ holdingId: h.id, ticker: null, reason: "no_ticker" });
      continue;
    }
    const req: QuoteRequest = { ticker, assetClass: h.assetClass, currency: h.currency };
    const key = quoteRequestKey(req);
    const entry = requests.get(key) ?? { ...req, holdingIds: [] };
    entry.holdingIds.push({ id: h.id, currency: h.currency });
    requests.set(key, entry);
  }
  if (!requests.size) return result;

  // fetchQuotesDetailed keys by ticker, so the same coin in two currencies needs two calls.
  const batches = new Map<string, QuoteRequest[]>();
  for (const r of requests.values()) {
    const batch = r.assetClass === "crypto" ? (r.currency ?? "USD").toUpperCase() : "";
    batches.set(batch, [...(batches.get(batch) ?? []), r]);
  }
  const quotesByKey = new Map<string, Quote>();
  const attemptsByKey = new Map<string, QuoteAttempt>();
  await Promise.all(
    [...batches].map(async ([currency, reqs]) => {
      const { quotes, attempts } = await fetchQuotesDetailed(reqs, { brapiToken: env.BRAPI_TOKEN, cryptoCurrency: currency || undefined });
      for (const r of reqs) {
        const key = quoteRequestKey(r);
        const quote = quotes[r.ticker];
        if (quote) quotesByKey.set(key, quote);
        const attempt = attempts.find((a) => a.ticker === r.ticker);
        if (attempt) attemptsByKey.set(key, attempt);
      }
    }),
  );

  const now = new Date();
  const updates: Promise<unknown>[] = [];
  let latestQuoteAt: Date | null = null;
  for (const [key, req] of requests) {
    const quote = quotesByKey.get(key);
    if (!quote) {
      const attempt = attemptsByKey.get(key);
      const reason: PriceUpdateReason = attempt && attempt.outcome !== "ok" ? attempt.outcome : "not_found";
      result.missing.push(req.ticker);
      for (const h of req.holdingIds) result.issues.push({ holdingId: h.id, ticker: req.ticker, reason });
      continue;
    }
    result.bySource[quote.source]++;
    const asOf = quote.asOf ? new Date(quote.asOf) : null;
    if (asOf && !Number.isNaN(asOf.getTime()) && (!latestQuoteAt || asOf > latestQuoteAt)) latestQuoteAt = asOf;
    for (const h of req.holdingIds) {
      // A price in the wrong currency would silently misvalue the holding (see holding-value.ts): reject it instead of applying it.
      if (quote.currency.toUpperCase() !== h.currency.toUpperCase()) {
        result.issues.push({ holdingId: h.id, ticker: req.ticker, reason: "currency_mismatch", quotedCurrency: quote.currency });
        continue;
      }
      updates.push(
        db.investmentHolding
          .update({ where: { id: h.id }, data: { currentPrice: quote.price, lastPriceUpdate: now } })
          .then(() => {
            result.updated++;
          })
          .catch((err) => {
            console.error(`[PriceUpdate] Failed to update holding ${h.id}:`, err);
            result.failed++;
            result.issues.push({ holdingId: h.id, ticker: req.ticker, reason: "write_failed" });
          }),
      );
    }
  }
  await Promise.all(updates);
  result.latestQuoteAt = latestQuoteAt ? latestQuoteAt.toISOString() : null;
  return result;
}
