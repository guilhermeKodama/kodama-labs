/**
 * Asks the live B3 chain for two tickers, provider by provider, and prints
 * what each answered and how many HTTP requests it took. Run by
 * market-data-live.flow.ts; touches no database.
 */
import { chainFor, brapiHasToken } from "../../src/server/modules/market-data/lib/registry";
import { quoteKind } from "../../src/server/modules/market-data/lib/calendar";

const TICKERS = ["ITUB4", "WEGE3"];

const requests = new Map<string, number>();
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const host = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).host;
  requests.set(host, (requests.get(host) ?? 0) + 1);
  return realFetch(input, init);
};

async function main() {
  const chain = chainFor("stocks").filter((p) => p.fetchPrices);
  console.log(`BRAPI_TOKEN ${brapiHasToken() ? "set" : "unset"} -> B3 chain: ${chain.map((p) => p.id).join(" -> ")}`);
  const today = new Date().toISOString().slice(0, 10);
  for (const ticker of TICKERS) {
    let winner: string | null = null;
    for (const provider of chain) {
      requests.clear();
      const result = await provider.fetchPrices!(ticker, { from: today, to: today });
      const calls = [...requests.values()].reduce((a, b) => a + b, 0);
      if (result.outcome === "ok") {
        const point = result.data.at(-1)!;
        const kind = quoteKind("B3", point.date, new Date());
        console.log(`${ticker} ${provider.id} ok ${point.date} ${point.currency} ${point.close} kind=${kind} requests=${calls}`);
        winner ??= provider.id;
      } else {
        console.log(`${ticker} ${provider.id} ${result.outcome} status=${result.status ?? "-"} requests=${calls}`);
      }
    }
    console.log(`${ticker} priced by: ${winner ?? "none"}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
