import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding } from "../portfolio";

const yahoo = vi.hoisted(() => ({
  quote: vi.fn(async (ticker: string) => {
    // "FOO" simulates a provider returning the wrong currency for the holding it was asked to price.
    if (ticker === "FOO") return { regularMarketPrice: 10, currency: "EUR", regularMarketTime: new Date("2026-10-05T17:32:00Z") };
    return undefined;
  }),
}));
vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = yahoo.quote;
  },
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://brapi.dev/api/quote/PETR4")) {
    return json({ results: [{ symbol: "PETR4", regularMarketPrice: 40.5, currency: "BRL", regularMarketTime: "2026-10-05T17:32:00.000Z" }] });
  }
  if (url.startsWith("https://brapi.dev/api/quote/")) return json({}, 404);
  if (url.startsWith("https://api.coingecko.com/api/v3/simple/price")) {
    return json({ bitcoin: { brl: 342100, last_updated_at: 1791222720 } });
  }
  return json({}, 404);
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const USER = "test-user-update-prices-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

async function holding(input: Omit<Parameters<typeof createHolding>[1], "accountId">) {
  return createHolding(USER, { accountId: f.broker, ...input }, prisma);
}

describe("updateAllPrices", () => {
  it("prices what it can and reports exactly why for everything else", async () => {
    const { updateAllPrices } = await import("../update-prices");

    const stock = await holding({ assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" });
    const crypto = await holding({ assetClass: "crypto", ticker: "BTC", name: "Bitcoin", currency: "BRL" });
    const fixedIncome = await holding({ assetClass: "fixed_income", ticker: "CDB123", name: "CDB Nubank", currency: "BRL" });
    const noTicker = await holding({ assetClass: "stocks", name: "Posição sem ticker", currency: "BRL" });
    const notFound = await holding({ assetClass: "stocks", ticker: "ZZZZ9", name: "Nada aqui", currency: "BRL" });
    const mismatched = await holding({ assetClass: "international_stocks", ticker: "FOO", name: "Mismatch Inc", currency: "USD" });

    // Scoped to this test's user: updateAllPrices with no userId is
    // deliberately global (that's what the cron needs), but capital_dev is
    // shared with every other test file running concurrently, and a
    // ticker as common as "PETR4" collides with their holdings too.
    const result = await updateAllPrices(prisma, { userId: USER });

    expect(result.totalHoldings).toBe(6);
    expect(result.updated).toBe(2);
    expect(result.bySource).toMatchObject({ brapi: 1, coingecko: 1 });

    const reasonFor = (holdingId: string) => result.issues.find((i) => i.holdingId === holdingId);
    expect(reasonFor(fixedIncome.id)).toMatchObject({ reason: "no_source" });
    expect(reasonFor(noTicker.id)).toMatchObject({ reason: "no_ticker", ticker: null });
    expect(reasonFor(notFound.id)).toMatchObject({ reason: "not_found", ticker: "ZZZZ9" });
    expect(reasonFor(mismatched.id)).toMatchObject({ reason: "currency_mismatch", quotedCurrency: "EUR" });
    expect(result.missing).toEqual(expect.arrayContaining(["ZZZZ9"]));
    expect(reasonFor(stock.id)).toBeUndefined();
    expect(reasonFor(crypto.id)).toBeUndefined();

    const stockRow = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: stock.id } });
    expect(stockRow.currentPrice).toBe(40.5);
    expect(stockRow.lastPriceUpdate).not.toBeNull();

    const mismatchedRow = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: mismatched.id } });
    expect(mismatchedRow.currentPrice).toBeNull();

    // The newer of the two applied quotes: coingecko's last_updated_at (BTC), after brapi's regularMarketTime (PETR4).
    expect(result.latestQuoteAt).toBe("2026-10-05T17:52:00.000Z");
  });

  it("is a no-op with no active holdings", async () => {
    const { updateAllPrices } = await import("../update-prices");
    const result = await updateAllPrices(prisma, { userId: USER });
    expect(result).toMatchObject({ totalHoldings: 0, updated: 0, missing: [], issues: [], latestQuoteAt: null });
  });

  it("scopes to one user when userId is given", async () => {
    const { updateAllPrices } = await import("../update-prices");
    const other = "test-user-update-prices-other-001";
    const otherFixture = await createLedgerFixture(prisma, other);
    try {
      await holding({ assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" });
      await createHolding(other, { accountId: otherFixture.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
      const result = await updateAllPrices(prisma, { userId: USER });
      expect(result.totalHoldings).toBe(1);
      expect(result.updated).toBe(1);
    } finally {
      await deleteLedgerFixture(prisma, other);
    }
  });
});
