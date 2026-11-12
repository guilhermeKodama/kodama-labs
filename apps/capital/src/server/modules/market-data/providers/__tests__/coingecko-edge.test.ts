import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coingeckoProvider, CRYPTO_NAMES, CRYPTO_SYMBOL_TO_COINGECKO_ID } from "../coingecko";

const RANGE = { from: "2026-01-01", to: "2026-01-01" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("coingecko fetchPrices", () => {
  it("is not_found for an empty coin id or empty currency, without calling the API", async () => {
    expect(await coingeckoProvider.fetchPrices!(":usd", RANGE)).toEqual({ outcome: "not_found", status: 200 });
    expect(await coingeckoProvider.fetchPrices!("bitcoin:", RANGE)).toEqual({ outcome: "not_found", status: 200 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queries the lower-cased currency and keeps the upper-cased one on the point, dated by last_updated_at", async () => {
    fetchMock.mockResolvedValueOnce(json({ ethereum: { brl: 18000.5, last_updated_at: Date.parse("2026-10-05T17:32:00Z") / 1000 } }));
    const result = await coingeckoProvider.fetchPrices!("ethereum:BRL", RANGE);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=brl&include_last_updated_at=true");
    expect(result).toEqual({
      outcome: "ok",
      status: 200,
      data: [{ date: "2026-10-05", close: 18000.5, currency: "BRL", asOf: "2026-10-05T17:32:00.000Z" }],
    });
  });

  it("dates a price without last_updated_at today and leaves asOf out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
    fetchMock.mockResolvedValueOnce(json({ bitcoin: { usd: 65000 } }));
    const result = await coingeckoProvider.fetchPrices!("bitcoin:usd", RANGE);
    expect(result).toEqual({ outcome: "ok", status: 200, data: [{ date: "2026-11-12", close: 65000, currency: "USD", asOf: undefined }] });
  });

  it("is not_found for a zero or non-numeric price", async () => {
    fetchMock.mockResolvedValueOnce(json({ bitcoin: { usd: 0 } }));
    expect((await coingeckoProvider.fetchPrices!("bitcoin:usd", RANGE)).outcome).toBe("not_found");
    fetchMock.mockResolvedValueOnce(json({ bitcoin: { usd: "65000" } }));
    expect((await coingeckoProvider.fetchPrices!("bitcoin:usd", RANGE)).outcome).toBe("not_found");
  });
});

describe("coingecko lookup", () => {
  it("returns nothing for a query shorter than two characters, without calling the API", async () => {
    expect(await coingeckoProvider.lookup!(" b ")).toEqual({ outcome: "ok", status: 200, data: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nothing, without calling the API, when no supported coin matches", async () => {
    expect(await coingeckoProvider.lookup!("zzzzzz")).toEqual({ outcome: "ok", status: 200, data: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches by symbol prefix, display name and coin id, in one batched request, pricing only positive quotes", async () => {
    fetchMock.mockResolvedValueOnce(json({ bitcoin: { usd: 65000 }, "avalanche-2": { usd: 0 } }));
    const bySymbol = await coingeckoProvider.lookup!("btc");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    expect(bySymbol).toEqual({
      outcome: "ok",
      status: 200,
      data: [{ externalId: "bitcoin:usd", symbol: "BTC", name: "Bitcoin", assetClass: "crypto", currency: "USD", price: 65000 }],
    });

    fetchMock.mockResolvedValueOnce(json({ "avalanche-2": { usd: 0 } }));
    const byCoinId = await coingeckoProvider.lookup!("avalanche-2");
    expect(byCoinId.outcome === "ok" && byCoinId.data).toEqual([
      { externalId: "avalanche-2:usd", symbol: "AVAX", name: "Avalanche", assetClass: "crypto", currency: "USD", price: null },
    ]);

    fetchMock.mockResolvedValueOnce(json({}));
    const byName = await coingeckoProvider.lookup!("polygon");
    expect(byName.outcome === "ok" && byName.data.map((m) => m.symbol)).toEqual(["MATIC"]);
  });

  it("passes a failed request through", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await coingeckoProvider.lookup!("btc")).toEqual({ outcome: "not_found", status: 404 });
  });

  it("keeps the symbol and name tables in step", () => {
    expect(Object.keys(CRYPTO_NAMES).sort()).toEqual(Object.keys(CRYPTO_SYMBOL_TO_COINGECKO_ID).sort());
  });
});
