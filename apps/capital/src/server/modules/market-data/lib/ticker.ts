/** B3 tickers end with a digit (PETR4, VALE3, HGLG11, BOVA11) — the one heuristic quotes.ts and resolve-asset.ts both need to route a plain "etf"-classed ticker to brapi or Alpha Vantage. */
export function isBrazilianTicker(ticker: string): boolean {
  return /\d$/.test(ticker);
}
