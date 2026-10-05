import type { DbClient } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { fetchQuotes, quoteSourceFor, type Quote, type QuoteRequest } from "../lib/quotes";

interface PriceUpdateResult {
  totalHoldings: number;
  updated: number;
  /** Holdings whose price could not be written. */
  failed: number;
  /** Tickers no source returned a price for. */
  missing: string[];
  bySource: {
    coingecko: number;
    brapi: number;
    yahoo: number;
  };
}

/**
 * Fetches the current price of every active holding with a ticker (one
 * user's with `userId`) and stores it with the time of the update. Crypto is
 * priced in its holding's currency, B3 tickers on brapi.dev (Yahoo ".SA" as
 * fallback) and the rest on Yahoo Finance (see lib/quotes.ts).
 */
export async function updateAllPrices(db: DbClient, opts: { userId?: string } = {}): Promise<PriceUpdateResult> {
  const result: PriceUpdateResult = { totalHoldings: 0, updated: 0, failed: 0, missing: [], bySource: { coingecko: 0, brapi: 0, yahoo: 0 } };

  const holdings = await db.investmentHolding.findMany({
    where: {
      isActive: true,
      ticker: { not: null },
      NOT: { ticker: "" },
      ...(opts.userId && { account: { userId: opts.userId } }),
    },
    select: { id: true, ticker: true, assetClass: true, currency: true },
  });
  result.totalHoldings = holdings.length;
  if (!holdings.length) return result;

  // One request per ticker; crypto per ticker and currency (priced in the holding's currency).
  const keyOf = (r: QuoteRequest) => (r.assetClass === "crypto" ? `${r.ticker}:${r.currency}` : r.ticker);
  const requests = new Map<string, QuoteRequest & { holdingIds: string[] }>();
  for (const h of holdings) {
    const ticker = h.ticker!.toUpperCase();
    if (!quoteSourceFor(ticker, h.assetClass)) continue;
    const req: QuoteRequest = { ticker, assetClass: h.assetClass, currency: h.currency };
    const entry = requests.get(keyOf(req)) ?? { ...req, holdingIds: [] };
    entry.holdingIds.push(h.id);
    requests.set(keyOf(req), entry);
  }

  // fetchQuotes keys by ticker, so the same coin in two currencies needs two calls.
  const batches = new Map<string, QuoteRequest[]>();
  for (const r of requests.values()) {
    const batch = r.assetClass === "crypto" ? (r.currency ?? "USD").toUpperCase() : "";
    batches.set(batch, [...(batches.get(batch) ?? []), r]);
  }
  const quotes = new Map<string, Quote>();
  await Promise.all(
    [...batches].map(async ([currency, reqs]) => {
      const found = await fetchQuotes(reqs, { brapiToken: env.BRAPI_TOKEN, cryptoCurrency: currency || undefined });
      for (const r of reqs) if (found[r.ticker]) quotes.set(keyOf(r), found[r.ticker]);
    })
  );

  const now = new Date();
  const updates: Promise<unknown>[] = [];
  for (const [key, req] of requests) {
    const quote = quotes.get(key);
    if (!quote) {
      result.missing.push(req.ticker);
      continue;
    }
    result.bySource[quote.source]++;
    for (const id of req.holdingIds) {
      updates.push(
        db.investmentHolding
          .update({ where: { id }, data: { currentPrice: quote.price, lastPriceUpdate: now } })
          .then(() => {
            result.updated++;
          })
          .catch((err) => {
            console.error(`[PriceUpdate] Failed to update holding ${id}:`, err);
            result.failed++;
          })
      );
    }
  }
  await Promise.all(updates);
  return result;
}
