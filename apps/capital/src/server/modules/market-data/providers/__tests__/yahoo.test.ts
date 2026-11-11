import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Scenario = "ok" | "not_found" | "provider_down";
let scenario: Scenario = "ok";

const yahoo = vi.hoisted(() => ({
  quote: vi.fn(),
  search: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = yahoo.quote;
    search = yahoo.search;
  },
}));

import { describeProviderContract } from "../../lib/__tests__/provider-contract";
import { yahooProvider } from "../yahoo";

beforeEach(() => {
  scenario = "ok";
  yahoo.quote.mockImplementation(async (ticker: string) => {
    if (scenario === "provider_down") throw new Error("network down");
    if (scenario === "not_found") return undefined;
    return { symbol: ticker, regularMarketPrice: 500.5, currency: "USD", regularMarketTime: new Date("2026-10-05T17:32:00Z") };
  });
  yahoo.search.mockImplementation(async () => {
    if (scenario === "provider_down") throw new Error("network down");
    return { quotes: [{ symbol: "VOO", shortname: "Vanguard S&P 500 ETF", quoteType: "ETF" }] };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describeProviderContract(yahooProvider, {
  validExternalId: "VOO",
  searchQuery: "VOO",
  arrangeOk: () => (scenario = "ok"),
  arrangeNotFound: () => (scenario = "not_found"),
  arrangeProviderDown: () => (scenario = "provider_down"),
  // yahoo-finance2's client has no 429 or schema-validation failure mode of its own in this adapter.
});

describe("yahooProvider.lookup", () => {
  it("drops B3 tickers (.SA), which come from brapi instead", async () => {
    yahoo.search.mockResolvedValueOnce({
      quotes: [
        { symbol: "VOO", shortname: "Vanguard S&P 500 ETF", quoteType: "ETF" },
        { symbol: "VALE3.SA", shortname: "Vale", quoteType: "EQUITY" },
      ],
    });
    const result = await yahooProvider.lookup!("v");
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") expect(result.data.map((m) => m.symbol)).toEqual(["VOO"]);
  });
});
