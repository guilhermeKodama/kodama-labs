import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SyncPricesResultLike {
  requested: number;
  priced: number;
  suspect: number;
  missing: number;
  bySource: Record<string, number>;
  providerLatestDate: Date | null;
  issues: unknown[];
}
const syncPricesMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<SyncPricesResultLike>>(async () => ({ requested: 0, priced: 0, suspect: 0, missing: 0, bySource: {}, providerLatestDate: null, issues: [] })),
);
vi.mock("@capital/server/modules/market-data/services/sync-prices", () => ({ syncPrices: syncPricesMock }));

import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, updateHolding } from "../portfolio";
import { marketFor } from "@capital/server/modules/market-data/lib/calendar";
import { refreshPricesLive, updateAllPrices } from "../update-prices";

const USER = "test-user-update-prices-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

afterEach(async () => {
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: "ZZUPD" } } });
});

async function holding(input: Omit<Parameters<typeof createHolding>[1], "accountId">) {
  return createHolding(USER, { accountId: f.broker, ...input }, prisma);
}

/** Links a holding to a freshly-created Asset and gives it a cached "ok" AssetPrice, the same end state the backfill script + sync-prices cron leave behind. */
async function linkAndPrice(holdingId: string, symbol: string, assetClass: string, currency: string, close: number, date: string, source = "brapi") {
  const asset = await prisma.asset.create({ data: { symbol, assetClass: assetClass as never, market: marketFor(assetClass as never, symbol) ?? "B3", currency } });
  await prisma.assetPrice.create({ data: { assetId: asset.id, date: new Date(`${date}T00:00:00Z`), close, source, status: "ok" } });
  await prisma.investmentHolding.update({ where: { id: holdingId }, data: { assetId: asset.id, priceSource: "auto" } });
  return asset;
}

describe("refreshPricesLive", () => {
  beforeEach(() => {
    syncPricesMock.mockClear();
  });

  it("syncs an already-linked asset live, then reads the fresh cache", async () => {
    const stock = await holding({ assetClass: "stocks", ticker: "ZZUPDRENT3", name: "Rent Co", currency: "BRL" });
    const asset = await linkAndPrice(stock.id, "ZZUPDRENT3", "stocks", "BRL", 12, "2026-11-09");

    syncPricesMock.mockImplementationOnce(async () => {
      // Simulates sync-prices writing today's close before refreshPricesLive reads the cache.
      await prisma.assetPrice.create({ data: { assetId: asset.id, date: new Date("2026-11-10T00:00:00Z"), close: 13.5, source: "brapi", status: "ok" } });
      return { requested: 1, priced: 1, suspect: 0, missing: 0, bySource: { brapi: 1 }, providerLatestDate: new Date("2026-11-10T00:00:00Z"), issues: [] };
    });

    const startedAt = new Date();
    await refreshPricesLive(prisma, USER);

    expect(syncPricesMock).toHaveBeenCalledOnce();
    expect(syncPricesMock.mock.calls[0]?.[1]).toEqual({ assetIds: [asset.id] });
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: stock.id } })).currentPrice).toBe(13.5);
    // The button's live fetch is on record, as a manual run the health panel's daily-job status ignores.
    const run = await prisma.integrationRun.findFirstOrThrow({ where: { job: "sync-prices", trigger: "manual", startedAt: { gte: startedAt } } });
    expect(run).toMatchObject({ status: "ok", requested: 1, succeeded: 1 });
    await prisma.integrationRun.delete({ where: { id: run.id } });
  });

  it("links a holding that isn't linked yet before syncing — the button catches up what the backfill script missed", async () => {
    const notLinked = await holding({ assetClass: "stocks", ticker: "ZZUPDSOMA3", name: "Soma", currency: "BRL" });
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: notLinked.id } })).assetId).toBeNull();

    await refreshPricesLive(prisma, USER);

    const after = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: notLinked.id } });
    expect(after).toMatchObject({ priceSource: "auto" });
    expect(after.assetId).not.toBeNull();
    expect(syncPricesMock).toHaveBeenCalledOnce();
    expect(syncPricesMock.mock.calls[0]?.[1]).toEqual({ assetIds: [after.assetId] });
  });

  it("skips the live fetch entirely when nothing can be linked (no ticker, or a class with no source)", async () => {
    await holding({ assetClass: "fixed_income", ticker: "CDB123", name: "CDB", currency: "BRL" });
    await holding({ assetClass: "stocks", name: "Sem ticker", currency: "BRL" });
    await refreshPricesLive(prisma, USER);
    expect(syncPricesMock).not.toHaveBeenCalled();
  });
});

describe("updateAllPrices", () => {
  it("refreshes cached-priced holdings from AssetPrice and reports exactly why for everything else, with no network call", async () => {
    const stock = await holding({ assetClass: "stocks", ticker: `ZZUPDPETR4`, name: "Petrobras", currency: "BRL" });
    const crypto = await holding({ assetClass: "crypto", ticker: "BTC", name: "Bitcoin", currency: "BRL" });
    const fixedIncome = await holding({ assetClass: "fixed_income", ticker: "CDB123", name: "CDB Nubank", currency: "BRL" });
    const noTicker = await holding({ assetClass: "stocks", name: "Posição sem ticker", currency: "BRL" });
    const notLinked = await holding({ assetClass: "stocks", ticker: "ZZUPDVALE3", name: "Linkável mas ainda não", currency: "BRL" });
    const mismatched = await holding({ assetClass: "international_stocks", ticker: "ZZUPDFOO", name: "Mismatch Inc", currency: "USD" });

    await linkAndPrice(stock.id, `ZZUPDPETR4`, "stocks", "BRL", 40.5, "2026-11-09", "brapi");
    await linkAndPrice(crypto.id, "ZZUPDBTC", "crypto", "BRL", 342100, "2026-11-10", "coingecko");
    await linkAndPrice(mismatched.id, "ZZUPDFOO", "international_stocks", "EUR", 10, "2026-11-10", "yahoo");

    const result = await updateAllPrices(prisma, { userId: USER });

    expect(result.totalHoldings).toBe(6);
    expect(result.updated).toBe(2);
    expect(result.bySource).toMatchObject({ brapi: 1, coingecko: 1 });

    const reasonFor = (holdingId: string) => result.issues.find((i) => i.holdingId === holdingId);
    expect(reasonFor(fixedIncome.id)).toMatchObject({ reason: "no_source" });
    expect(reasonFor(noTicker.id)).toMatchObject({ reason: "no_ticker", ticker: null });
    expect(reasonFor(notLinked.id)).toMatchObject({ reason: "no_price_cached", ticker: "ZZUPDVALE3" });
    expect(reasonFor(mismatched.id)).toMatchObject({ reason: "currency_mismatch", quotedCurrency: "EUR" });
    expect(result.missing).toEqual(expect.arrayContaining(["ZZUPDVALE3"]));
    expect(reasonFor(stock.id)).toBeUndefined();
    expect(reasonFor(crypto.id)).toBeUndefined();

    const stockRow = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: stock.id } });
    expect(stockRow.currentPrice).toBe(40.5);
    // No quote time on file: the moment that B3 session's close counts as available (19:00 in São Paulo), not midnight UTC.
    expect(stockRow.lastPriceUpdate).toEqual(new Date("2026-11-09T22:00:00Z"));

    const mismatchedRow = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: mismatched.id } });
    expect(mismatchedRow.currentPrice).toBeNull();

    // The newer of the two applied prices: coingecko's 2026-11-10 (BTC, the end of that UTC day), after brapi's 2026-11-09 (PETR4).
    expect(result.latestQuoteAt).toBe("2026-11-11T00:00:00.000Z");
  });

  it("stamps lastPriceUpdate with the quote's own time when the provider gave one", async () => {
    const stock = await holding({ assetClass: "stocks", ticker: "ZZUPDITUB4", name: "Itaú", currency: "BRL" });
    const asset = await linkAndPrice(stock.id, "ZZUPDITUB4", "stocks", "BRL", 33.1, "2026-11-10", "brapi");
    await prisma.assetPrice.updateMany({ where: { assetId: asset.id }, data: { asOf: new Date("2026-11-10T20:07:00Z") } });
    await updateAllPrices(prisma, { userId: USER });
    const row = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: stock.id } });
    expect(row.lastPriceUpdate).toEqual(new Date("2026-11-10T20:07:00Z"));
  });

  it("reports a holding whose currency isn't its market's as currency_mismatch, without linking it", async () => {
    const usdB3 = await holding({ assetClass: "stocks", ticker: "ZZUPDBBAS3", name: "BB em USD", currency: "USD" });
    const result = await updateAllPrices(prisma, { userId: USER });
    expect(result.issues.find((i) => i.holdingId === usdB3.id)).toMatchObject({ reason: "currency_mismatch", quotedCurrency: "BRL" });
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: usdB3.id } })).assetId).toBeNull();
  });

  it("ignores a 'suspect' AssetPrice: a holding only has a usable price once one is confirmed ok", async () => {
    const stock = await holding({ assetClass: "stocks", ticker: "ZZUPDWEGE3", name: "WEG", currency: "BRL" });
    const asset = await prisma.asset.create({ data: { symbol: "ZZUPDWEGE3", assetClass: "stocks", market: "B3", currency: "BRL" } });
    await prisma.assetPrice.create({ data: { assetId: asset.id, date: new Date("2026-11-10T00:00:00Z"), close: 60, source: "brapi", status: "suspect" } });
    await prisma.investmentHolding.update({ where: { id: stock.id }, data: { assetId: asset.id, priceSource: "auto" } });

    const result = await updateAllPrices(prisma, { userId: USER });
    expect(result.issues.find((i) => i.holdingId === stock.id)).toMatchObject({ reason: "no_price_cached" });
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: stock.id } })).currentPrice).toBeNull();
  });

  it("is a no-op with no active holdings", async () => {
    const result = await updateAllPrices(prisma, { userId: USER });
    expect(result).toMatchObject({ totalHoldings: 0, updated: 0, missing: [], issues: [], latestQuoteAt: null });
  });

  it("scopes to one user when userId is given", async () => {
    const other = "test-user-update-prices-other-001";
    const otherFixture = await createLedgerFixture(prisma, other);
    try {
      const mine = await holding({ assetClass: "stocks", ticker: "ZZUPDITUB4", name: "Itaú", currency: "BRL" });
      await linkAndPrice(mine.id, "ZZUPDITUB4", "stocks", "BRL", 30, "2026-11-10");
      const theirs = await createHolding(other, { accountId: otherFixture.broker, assetClass: "stocks", ticker: "ZZUPDBBAS3", name: "Banco do Brasil", currency: "BRL" }, prisma);
      await linkAndPrice(theirs.id, "ZZUPDBBAS3", "stocks", "BRL", 25, "2026-11-10");

      const result = await updateAllPrices(prisma, { userId: USER });
      expect(result.totalHoldings).toBe(1);
      expect(result.updated).toBe(1);
    } finally {
      await deleteLedgerFixture(prisma, other);
    }
  });
});

describe("updateHolding relinks when the holding's identity changes", () => {
  it("drops the old Asset and links the new ticker; a change to an unpriceable class goes manual", async () => {
    const h = await holding({ assetClass: "stocks", ticker: "ZZUPDOLD3", name: "Antiga", currency: "BRL" });
    const old = await linkAndPrice(h.id, "ZZUPDOLD3", "stocks", "BRL", 10, "2026-11-09");

    const renamed = await updateHolding(USER, h.id, { ticker: "ZZUPDNEW3" }, prisma);
    expect(renamed.assetId).not.toBe(old.id);
    expect(renamed.priceSource).toBe("auto");
    expect(await prisma.asset.findUniqueOrThrow({ where: { id: renamed.assetId! } })).toMatchObject({ symbol: "ZZUPDNEW3", market: "B3" });

    const asFixedIncome = await updateHolding(USER, h.id, { assetClass: "fixed_income" }, prisma);
    expect(asFixedIncome).toMatchObject({ assetId: null, priceSource: "manual" });
  });

  it("leaves the link alone when only the name changes", async () => {
    const h = await holding({ assetClass: "stocks", ticker: "ZZUPDKEEP3", name: "Mantém", currency: "BRL" });
    const asset = await linkAndPrice(h.id, "ZZUPDKEEP3", "stocks", "BRL", 10, "2026-11-09");
    const renamed = await updateHolding(USER, h.id, { name: "Outro nome" }, prisma);
    expect(renamed.assetId).toBe(asset.id);
  });
});
