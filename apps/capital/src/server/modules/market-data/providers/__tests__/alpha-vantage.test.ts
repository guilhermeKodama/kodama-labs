import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ ALPHA_VANTAGE_API_KEY: "test-key" as string | undefined }));
vi.mock("@/env", () => ({ env: envMock }));

import { describeProviderContract } from "../../lib/__tests__/provider-contract";
import {
  ALPHA_VANTAGE_MIN_GAP_MS,
  alphaVantageCurrency,
  alphaVantageExternalId,
  alphaVantageProvider,
  applyAlphaVantageCurrency,
  resetAlphaVantagePacing,
} from "../alpha-vantage";

const RANGE = { from: "2026-11-12", to: "2026-11-12" };

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function globalQuote(price: string, day = "2026-11-12") {
  return { "Global Quote": { "01. symbol": "SPY", "05. price": price, "07. latest trading day": day } };
}

type Scenario = "ok" | "not_found" | "rate_limited" | "provider_down" | "schema_changed";
let scenario: Scenario = "ok";

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
  if (scenario === "provider_down") throw new Error("getaddrinfo EAI_AGAIN");
  if (scenario === "rate_limited") return json({ Note: "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute and 25 calls per day." });
  if (scenario === "schema_changed") return json({ unexpected: true });
  if (scenario === "not_found") return json({ "Global Quote": {} });
  return json(globalQuote("500.5000"));
});

beforeEach(() => {
  scenario = "ok";
  envMock.ALPHA_VANTAGE_API_KEY = "test-key";
  resetAlphaVantagePacing(0);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    if (scenario === "provider_down") throw new Error("getaddrinfo EAI_AGAIN");
    if (scenario === "rate_limited") return json({ Note: "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute and 25 calls per day." });
    if (scenario === "schema_changed") return json({ unexpected: true });
    if (scenario === "not_found") return json({ "Global Quote": {} });
    return json(globalQuote("500.5000"));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetAlphaVantagePacing(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describeProviderContract(alphaVantageProvider, {
  validExternalId: "VOO",
  arrangeOk: () => (scenario = "ok"),
  arrangeNotFound: () => (scenario = "not_found"),
  arrangeRateLimited: () => (scenario = "rate_limited"),
  arrangeProviderDown: () => (scenario = "provider_down"),
  arrangeSchemaChanged: () => (scenario = "schema_changed"),
});

describe("alphaVantageExternalId", () => {
  it("keeps a US symbol and rewrites the LSE listings to .LON", () => {
    expect(alphaVantageExternalId("spy")).toBe("SPY");
    expect(alphaVantageExternalId("VUAA")).toBe("VUAA.LON");
    expect(alphaVantageExternalId("vuaa.l")).toBe("VUAA.LON");
    expect(alphaVantageExternalId("VUAA.LON")).toBe("VUAA.LON");
    expect(alphaVantageExternalId("CNDX")).toBe("CNDX.LON");
    expect(alphaVantageExternalId("cndx.l")).toBe("CNDX.LON");
    expect(alphaVantageExternalId("VWRL.L")).toBe("VWRL.LON");
  });
});

describe("alphaVantageCurrency", () => {
  it("prices US listings and the USD LSE UCITS symbols in USD, and leaves any other dotted symbol unknown", () => {
    expect(alphaVantageCurrency("SPY")).toBe("USD");
    expect(alphaVantageCurrency("VUAA")).toBe("USD");
    expect(alphaVantageCurrency("CNDX.L")).toBe("USD");
    expect(alphaVantageCurrency("VUAA.LON")).toBe("USD");
    expect(alphaVantageCurrency("VWRL.LON")).toBeNull();
    expect(alphaVantageCurrency("SHOP.TO")).toBeNull();
  });
});

describe("applyAlphaVantageCurrency", () => {
  const point = (close: number, currency = "") => ({ date: "2026-11-12", close, currency });

  it("keeps a currency the quote already named", () => {
    expect(applyAlphaVantageCurrency("SPY", point(500, "USD"), "GBP")).toEqual(point(500, "USD"));
  });

  it("treats a GBP LSE quote as pence, leaves GBX and USD alone, and refuses anything else", () => {
    expect(applyAlphaVantageCurrency("VWRL.LON", point(10000), "GBP")).toEqual(point(100, "GBP"));
    expect(applyAlphaVantageCurrency("VWRL.L", point(10000), "gbx")).toEqual(point(10000, "GBX"));
    expect(applyAlphaVantageCurrency("VWRL.LON", point(100), "USD")).toEqual(point(100, "USD"));
    expect(applyAlphaVantageCurrency("VWRL.LON", point(100), "EUR")).toBeNull();
  });

  it("stamps any other unknown suffix with the asset's currency", () => {
    expect(applyAlphaVantageCurrency("SHOP.TO", point(80), "CAD")).toEqual(point(80, "CAD"));
    expect(applyAlphaVantageCurrency("SHOP.TO", point(80), "  ")).toBeNull();
  });
});

describe("alphaVantage fetchPrices", () => {
  it("reads the price and the latest trading day, and asks for the mapped symbol", async () => {
    fetchMock.mockResolvedValueOnce(json(globalQuote("147.7800", "2026-11-12")));
    const result = await alphaVantageProvider.fetchPrices!("vuaa", RANGE);
    expect(result).toEqual({
      outcome: "ok",
      status: 200,
      data: [{ date: "2026-11-12", close: 147.78, currency: "USD" }],
    });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("function=GLOBAL_QUOTE");
    expect(url).toContain("symbol=VUAA.LON");
    expect(url).toContain("apikey=test-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is not_found for an empty Global Quote, a zero price, and an Error Message", async () => {
    fetchMock.mockResolvedValueOnce(json({ "Global Quote": {} }));
    expect(await alphaVantageProvider.fetchPrices!("NOPE", RANGE)).toEqual({ outcome: "not_found", status: 200 });
    fetchMock.mockResolvedValueOnce(json(globalQuote("0.0000")));
    expect(await alphaVantageProvider.fetchPrices!("NOPE", RANGE)).toEqual({ outcome: "not_found", status: 200 });
    fetchMock.mockResolvedValueOnce(json({ "Error Message": "Invalid API call." }));
    expect(await alphaVantageProvider.fetchPrices!("NOPE", RANGE)).toEqual({ outcome: "not_found", status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats a Note or Information body as rate_limited and does not retry it", async () => {
    fetchMock.mockResolvedValueOnce(json({ Note: "Thank you for using Alpha Vantage! frequency is 5 calls per minute." }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "rate_limited", status: 200, retryAfterMs: null });
    fetchMock.mockResolvedValueOnce(json({ Information: "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day." }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "rate_limited", status: 200, retryAfterMs: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("test-key");
  });

  it("is schema_changed when the body is not a quote and when the trading day is missing", async () => {
    fetchMock.mockResolvedValueOnce(json([1, 2, 3]));
    expect((await alphaVantageProvider.fetchPrices!("SPY", RANGE)).outcome).toBe("schema_changed");
    fetchMock.mockResolvedValueOnce(json({ "Global Quote": { "05. price": "10" } }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toMatchObject({ outcome: "schema_changed", error: "missing latest trading day" });
    fetchMock.mockResolvedValueOnce(json({ "Global Quote": "nope" }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toMatchObject({ outcome: "schema_changed" });
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }));
    expect((await alphaVantageProvider.fetchPrices!("SPY", RANGE)).outcome).toBe("schema_changed");
  });

  it("does not retry a timeout, a 5xx, or a 429", async () => {
    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN"));
    expect(await alphaVantageProvider.fetchPrices!("CNDX.LON", RANGE)).toEqual({ outcome: "provider_down", status: null, error: "getaddrinfo EAI_AGAIN" });

    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "provider_down", status: 503, error: "HTTP 503" });

    fetchMock.mockResolvedValueOnce(new Response("down", { status: 500 }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "provider_down", status: 500, error: "HTTP 500" });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "13" } }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "rate_limited", status: 429, retryAfterMs: 13_000 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports a non-Error rejection as provider_down after the one attempt", async () => {
    fetchMock.mockRejectedValueOnce("ECONNRESET");
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "provider_down", status: null, error: "ECONNRESET" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a Note or Information that names an invalid key or a premium plan as unauthorized, once", async () => {
    fetchMock.mockResolvedValueOnce(json({ Information: "Invalid API key. Please claim your free API key at alphavantage.co." }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "unauthorized", status: 200 });
    fetchMock.mockResolvedValueOnce(json({ Note: "This is a premium endpoint. Subscribe to any premium plan to instantly unlock." }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "unauthorized", status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("test-key");
  });

  it("leaves the currency blank for an LSE symbol that is not a known USD listing", async () => {
    fetchMock.mockResolvedValueOnce(json(globalQuote("10000.0000")));
    expect(await alphaVantageProvider.fetchPrices!("VWRL.LON", RANGE)).toEqual({
      outcome: "ok",
      status: 200,
      data: [{ date: "2026-11-12", close: 10000, currency: "" }],
    });
  });

  it("does not call the network without a key, and does not retry a 401 or a 400", async () => {
    envMock.ALPHA_VANTAGE_API_KEY = "  ";
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "unauthorized", status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();

    envMock.ALPHA_VANTAGE_API_KEY = "test-key";
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "unauthorized", status: 401 });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 400 }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "provider_down", status: 400, error: "HTTP 400" });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await alphaVantageProvider.fetchPrices!("SPY", RANGE)).toEqual({ outcome: "not_found", status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("spaces calls at least 13s apart, including ones started together", async () => {
    vi.useFakeTimers();
    resetAlphaVantagePacing(ALPHA_VANTAGE_MIN_GAP_MS);
    const started: number[] = [];
    fetchMock.mockImplementation(async () => {
      started.push(Date.now());
      return json(globalQuote("10.0000"));
    });

    const pending = Promise.all([
      alphaVantageProvider.fetchPrices!("SPY", RANGE),
      alphaVantageProvider.fetchPrices!("VOO", RANGE),
      alphaVantageProvider.fetchPrices!("SCHD", RANGE),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ALPHA_VANTAGE_MIN_GAP_MS);
    expect(started).toHaveLength(2);
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(ALPHA_VANTAGE_MIN_GAP_MS);
    await vi.advanceTimersByTimeAsync(ALPHA_VANTAGE_MIN_GAP_MS);
    const results = await pending;
    expect(started).toHaveLength(3);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(ALPHA_VANTAGE_MIN_GAP_MS);
    expect(results.map((r) => r.outcome)).toEqual(["ok", "ok", "ok"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
