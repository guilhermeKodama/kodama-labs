import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass } from "@prisma/client";
import { env } from "@/env";

// ============================================
// CoinGecko - Crypto prices
// ============================================

const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";

const CRYPTO_SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  ADA: "cardano",
  SOL: "solana",
  DOT: "polkadot",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  MATIC: "matic-network",
  LINK: "chainlink",
  XRP: "ripple",
  USDT: "tether",
  USDC: "usd-coin",
  UNI: "uniswap",
  AAVE: "aave",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
};

async function fetchCryptoPrices(
  tickers: string[],
  currency: string = "usd"
): Promise<Record<string, number>> {
  const ids = tickers
    .map((t) => CRYPTO_SYMBOL_TO_COINGECKO_ID[t.toUpperCase()])
    .filter(Boolean)
    .join(",");

  if (!ids) return {};

  const vsCurrency = currency.toLowerCase();
  const url = `${COINGECKO_API}?ids=${ids}&vs_currencies=${vsCurrency}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[PriceUpdate] CoinGecko error: ${res.status}`);
      return {};
    }

    const data = await res.json();
    const prices: Record<string, number> = {};

    for (const [symbol, cgId] of Object.entries(CRYPTO_SYMBOL_TO_COINGECKO_ID)) {
      if (
        data[cgId] &&
        data[cgId][vsCurrency] &&
        tickers.some((t) => t.toUpperCase() === symbol)
      ) {
        prices[symbol] = data[cgId][vsCurrency];
      }
    }

    return prices;
  } catch (error) {
    console.error("[PriceUpdate] CoinGecko fetch failed:", error);
    return {};
  }
}

// ============================================
// brapi.dev - Brazilian B3 stocks, FIIs, ETFs, BDRs
// ============================================

const BRAPI_API = "https://brapi.dev/api/quote";

async function fetchBrazilianPrices(
  tickers: string[],
  token?: string
): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};

  // brapi.dev supports comma-separated tickers
  const tickerList = tickers.join(",");
  const url = token
    ? `${BRAPI_API}/${tickerList}?token=${token}`
    : `${BRAPI_API}/${tickerList}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[PriceUpdate] brapi.dev error: ${res.status}`);
      return {};
    }

    const data = (await res.json()) as {
      results?: Array<{
        symbol: string;
        regularMarketPrice: number;
      }>;
    };

    const prices: Record<string, number> = {};
    if (data.results) {
      for (const result of data.results) {
        if (result.symbol && result.regularMarketPrice) {
          prices[result.symbol.toUpperCase()] = result.regularMarketPrice;
        }
      }
    }

    return prices;
  } catch (error) {
    console.error("[PriceUpdate] brapi.dev fetch failed:", error);
    return {};
  }
}

// ============================================
// Yahoo Finance - International stocks/ETFs
// ============================================

async function fetchYahooPrices(
  tickers: string[]
): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};

  try {
    // Dynamic import to avoid issues with SSR
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new (YahooFinance as unknown as new () => {
      quote: (ticker: string) => Promise<{ regularMarketPrice?: number } | null>;
    })();

    const prices: Record<string, number> = {};

    // Fetch quotes in parallel (batch of up to 20)
    const batchSize = 20;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const promises = batch.map(async (ticker) => {
        try {
          const quote = await yf.quote(ticker);
          if (quote && quote.regularMarketPrice) {
            prices[ticker.toUpperCase()] = quote.regularMarketPrice;
          }
        } catch (err) {
          console.error(
            `[PriceUpdate] Yahoo Finance error for ${ticker}:`,
            err
          );
        }
      });
      await Promise.all(promises);
    }

    return prices;
  } catch (error) {
    console.error("[PriceUpdate] Yahoo Finance fetch failed:", error);
    return {};
  }
}

// ============================================
// Determine which API to use based on asset class
// ============================================

// Brazilian market asset classes
const BRAZILIAN_ASSET_CLASSES: AssetClass[] = ["stocks", "fii", "bdr"];

// International asset classes
const INTERNATIONAL_ASSET_CLASSES: AssetClass[] = [
  "international_stocks",
  "international_etf",
];

function isBrazilianTicker(ticker: string): boolean {
  // Brazilian tickers typically end with a digit (PETR4, VALE3, HGLG11, BOVA11)
  return /\d$/.test(ticker);
}

// ============================================
// Main update function
// ============================================

interface PriceUpdateResult {
  totalHoldings: number;
  updated: number;
  failed: number;
  bySource: {
    coingecko: number;
    brapi: number;
    yahoo: number;
  };
}

export async function updateAllPrices(
  db: DbClient
): Promise<PriceUpdateResult> {
  const result: PriceUpdateResult = {
    totalHoldings: 0,
    updated: 0,
    failed: 0,
    bySource: { coingecko: 0, brapi: 0, yahoo: 0 },
  };

  // 1. Fetch all active holdings with non-empty tickers
  const holdings = await db.investmentHolding.findMany({
    where: {
      isActive: true,
      ticker: { not: null },
      NOT: { ticker: "" },
    },
    select: {
      id: true,
      ticker: true,
      assetClass: true,
      currency: true,
    },
  });

  result.totalHoldings = holdings.length;
  if (holdings.length === 0) return result;

  // 2. Group tickers by source
  const cryptoTickers: string[] = [];
  const brazilianTickers: string[] = [];
  const yahooTickers: string[] = [];

  const holdingsByTicker: Record<
    string,
    Array<{ id: string; currency: string }>
  > = {};

  for (const h of holdings) {
    if (!h.ticker) continue;
    const ticker = h.ticker.toUpperCase();

    if (!holdingsByTicker[ticker]) {
      holdingsByTicker[ticker] = [];
    }
    holdingsByTicker[ticker].push({ id: h.id, currency: h.currency });

    if (h.assetClass === "crypto") {
      if (!cryptoTickers.includes(ticker)) cryptoTickers.push(ticker);
    } else if (
      BRAZILIAN_ASSET_CLASSES.includes(h.assetClass) ||
      (h.assetClass === "etf" && isBrazilianTicker(ticker))
    ) {
      if (!brazilianTickers.includes(ticker)) brazilianTickers.push(ticker);
    } else if (
      INTERNATIONAL_ASSET_CLASSES.includes(h.assetClass) ||
      (h.assetClass === "etf" && !isBrazilianTicker(ticker))
    ) {
      if (!yahooTickers.includes(ticker)) yahooTickers.push(ticker);
    }
  }

  // 3. Fetch prices from all sources in parallel
  const [cryptoPrices, brazilianPrices, yahooPrices] = await Promise.all([
    fetchCryptoPrices(
      cryptoTickers,
      // Use the currency of the first crypto holding (usually USD)
      holdings.find((h) => h.assetClass === "crypto")?.currency || "usd"
    ),
    fetchBrazilianPrices(brazilianTickers, env.BRAPI_TOKEN),
    fetchYahooPrices(yahooTickers),
  ]);

  // 3b. Fallback: For any Brazilian tickers that brapi.dev didn't return prices for,
  // try Yahoo Finance with .SA suffix (works for B3 stocks, BDRs, FIIs, ETFs)
  const missingBrazilianTickers = brazilianTickers.filter(
    (t) => !(t in brazilianPrices)
  );

  let yahooFallbackPrices: Record<string, number> = {};
  if (missingBrazilianTickers.length > 0) {
    console.log(
      `[PriceUpdate] brapi.dev missed ${missingBrazilianTickers.length} tickers, trying Yahoo Finance fallback: ${missingBrazilianTickers.join(", ")}`
    );
    // Yahoo Finance uses .SA suffix for B3 tickers (e.g., AMZO34.SA, PETR4.SA)
    const yahooSuffixedTickers = missingBrazilianTickers.map((t) => `${t}.SA`);
    const fallbackRaw = await fetchYahooPrices(yahooSuffixedTickers);

    // Map back from "AMZO34.SA" → "AMZO34"
    for (const [yahooTicker, price] of Object.entries(fallbackRaw)) {
      const originalTicker = yahooTicker.replace(/\.SA$/i, "");
      yahooFallbackPrices[originalTicker] = price;
    }
  }

  // 4. Merge all prices (Yahoo fallback fills gaps from brapi.dev)
  const allPrices: Record<string, number> = {
    ...cryptoPrices,
    ...brazilianPrices,
    ...yahooFallbackPrices,
    ...yahooPrices,
  };

  result.bySource.coingecko = Object.keys(cryptoPrices).length;
  result.bySource.brapi =
    Object.keys(brazilianPrices).length +
    Object.keys(yahooFallbackPrices).length;
  result.bySource.yahoo = Object.keys(yahooPrices).length;

  // 5. Batch update holdings
  const now = new Date();
  const updates: Promise<unknown>[] = [];

  for (const [ticker, price] of Object.entries(allPrices)) {
    const holdingsForTicker = holdingsByTicker[ticker];
    if (!holdingsForTicker) continue;

    for (const h of holdingsForTicker) {
      updates.push(
        (db as unknown as { $executeRawUnsafe: (query: string, ...args: unknown[]) => Promise<number> })
          .$executeRawUnsafe(
            `UPDATE "investment_holdings" SET "currentPrice" = $1, "lastPriceUpdate" = $2, "updatedAt" = $2 WHERE "id" = $3`,
            price,
            now,
            h.id
          )
          .then(() => {
            result.updated++;
          })
          .catch((err) => {
            console.error(
              `[PriceUpdate] Failed to update holding ${h.id}:`,
              err
            );
            result.failed++;
          })
      );
    }
  }

  await Promise.all(updates);

  return result;
}
