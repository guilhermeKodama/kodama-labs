import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchOutcome } from "@capital/server/lib/http";
import { prisma } from "@capital/server/lib/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { marketFor } from "../../lib/calendar";
import type { MarketDataProvider, PricePoint } from "../../lib/provider";

const registryMock = vi.hoisted(() => ({ chainFor: vi.fn<(assetClass: string) => MarketDataProvider[]>() }));
vi.mock("../../lib/registry", () => ({ chainFor: registryMock.chainFor }));

import { syncPrices } from "../sync-prices";

const SYMBOL_PREFIX = "ZZSYNC";

function ok(point: PricePoint): FetchOutcome<PricePoint[]> {
  return { outcome: "ok", status: 200, data: [point] };
}
function notFound(): FetchOutcome<PricePoint[]> {
  return { outcome: "not_found", status: 404 };
}
function providerDown(error = "boom"): FetchOutcome<PricePoint[]> {
  return { outcome: "provider_down", status: null, error };
}

function stubProvider(id: string, markets: string[], impl: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return { id, capabilities: ["prices"], markets: markets as MarketDataProvider["markets"], ...impl };
}

async function createAsset(symbol: string, assetClass: string, currency: string, refs: { source: string; externalId: string }[]) {
  const asset = await prisma.asset.create({ data: { symbol, assetClass: assetClass as never, market: marketFor(assetClass as never, symbol) ?? "B3", currency } });
  for (const r of refs) await prisma.assetSourceRef.create({ data: { assetId: asset.id, source: r.source, externalId: r.externalId } });
  return asset;
}

beforeEach(() => {
  registryMock.chainFor.mockReset();
});

afterEach(async () => {
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: SYMBOL_PREFIX } } });
});

describe("syncPrices", () => {
  it("prices an asset from its one source and writes an ok AssetPrice", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 38.2, currency: "BRL" })) });
    registryMock.chainFor.mockReturnValue([providerA]);

    const asset = await createAsset(`${SYMBOL_PREFIX}A`, "stocks", "BRL", [{ source: "fixtureA", externalId: `${SYMBOL_PREFIX}A` }]);
    const result = await syncPrices(prisma, { assetIds: [asset.id] });

    expect(result).toMatchObject({ requested: 1, priced: 1, suspect: 0, missing: 0, bySource: { fixtureA: 1 } });
    expect(result.providerLatestDate).toEqual(new Date("2026-11-10T00:00:00Z"));
    const price = await prisma.assetPrice.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(price).toMatchObject({ close: expect.anything(), source: "fixtureA", status: "ok" });
    expect(Number(price.close)).toBeCloseTo(38.2);
  });

  it("falls through the chain when the first provider can't price it", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => notFound()) });
    const providerB = stubProvider("fixtureB", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 10, currency: "BRL" })) });
    registryMock.chainFor.mockReturnValue([providerA, providerB]);

    const asset = await createAsset(`${SYMBOL_PREFIX}B`, "stocks", "BRL", [
      { source: "fixtureA", externalId: "x" },
      { source: "fixtureB", externalId: "y" },
    ]);
    const result = await syncPrices(prisma, { assetIds: [asset.id] });

    expect(result).toMatchObject({ priced: 1, missing: 0, bySource: { fixtureB: 1 } });
    expect(providerA.fetchPrices).toHaveBeenCalledOnce();
    expect(providerB.fetchPrices).toHaveBeenCalledOnce();
  });

  it("is missing when every provider in the chain fails", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => providerDown()) });
    registryMock.chainFor.mockReturnValue([providerA]);

    const asset = await createAsset(`${SYMBOL_PREFIX}C`, "stocks", "BRL", [{ source: "fixtureA", externalId: "x" }]);
    const result = await syncPrices(prisma, { assetIds: [asset.id] });

    expect(result).toMatchObject({ priced: 0, missing: 1 });
    expect(result.issues).toEqual([{ assetId: asset.id, symbol: `${SYMBOL_PREFIX}C`, outcome: "provider_down", source: "fixtureA", error: "boom" }]);
  });

  it("is missing with no_source when the asset has no ref any provider in the chain recognizes", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 10, currency: "BRL" })) });
    registryMock.chainFor.mockReturnValue([providerA]);

    const asset = await createAsset(`${SYMBOL_PREFIX}D`, "stocks", "BRL", [{ source: "someOtherSource", externalId: "x" }]);
    const result = await syncPrices(prisma, { assetIds: [asset.id] });

    expect(result).toMatchObject({ missing: 1, issues: [{ assetId: asset.id, symbol: `${SYMBOL_PREFIX}D`, outcome: "no_source", source: null }] });
    expect(providerA.fetchPrices).not.toHaveBeenCalled();
  });

  it("rejects a point acceptPrice flags, writing nothing", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 38.2, currency: "USD" })) });
    registryMock.chainFor.mockReturnValue([providerA]);

    const asset = await createAsset(`${SYMBOL_PREFIX}E`, "stocks", "BRL", [{ source: "fixtureA", externalId: "x" }]);
    const result = await syncPrices(prisma, { assetIds: [asset.id] });

    expect(result).toMatchObject({ priced: 0, missing: 1, issues: [{ assetId: asset.id, outcome: "rejected", source: "fixtureA" }] });
    expect(await prisma.assetPrice.findFirst({ where: { assetId: asset.id } })).toBeNull();
  });

  it("writes a jump past the class limit as suspect, then promotes it to ok once a later close confirms it", async () => {
    const close = vi.fn(async () => ok({ date: "2026-11-10", close: 60, currency: "BRL" }));
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: close });
    registryMock.chainFor.mockReturnValue([providerA]);

    const asset = await createAsset(`${SYMBOL_PREFIX}F`, "stocks", "BRL", [{ source: "fixtureA", externalId: "x" }]);
    await prisma.assetPrice.create({ data: { assetId: asset.id, date: new Date("2026-11-09T00:00:00Z"), close: 38, source: "fixtureA", status: "ok" } });

    const day1 = await syncPrices(prisma, { assetIds: [asset.id] });
    expect(day1).toMatchObject({ priced: 0, suspect: 1 });
    const day1Row = await prisma.assetPrice.findFirstOrThrow({ where: { assetId: asset.id, date: new Date("2026-11-10T00:00:00Z") } });
    expect(day1Row.status).toBe("suspect");

    close.mockResolvedValueOnce(ok({ date: "2026-11-11", close: 61, currency: "BRL" }));
    const day2 = await syncPrices(prisma, { assetIds: [asset.id] });
    expect(day2).toMatchObject({ priced: 1, suspect: 0 });
    expect((await prisma.assetPrice.findFirstOrThrow({ where: { id: day1Row.id } })).status).toBe("ok");
  });

  it("judges a point against an earlier day's close, so a same-day intraday quote can't confirm a suspect close", async () => {
    const fetchPrices = vi.fn(async () => ok({ date: "2026-11-10", close: 61, currency: "BRL", asOf: "2026-11-10T16:55:00Z" }));
    registryMock.chainFor.mockReturnValue([stubProvider("fixtureA", ["stocks"], { fetchPrices })]);

    const asset = await createAsset(`${SYMBOL_PREFIX}K`, "stocks", "BRL", [{ source: "fixtureA", externalId: "k" }]);
    await prisma.assetPrice.create({ data: { assetId: asset.id, date: new Date("2026-11-09T00:00:00Z"), close: 38, source: "fixtureA", status: "ok" } });
    await prisma.assetPrice.create({ data: { assetId: asset.id, date: new Date("2026-11-10T00:00:00Z"), close: 60, source: "fixtureA", status: "suspect" } });

    // 14:00 in São Paulo: the session is still open.
    const result = await syncPrices(prisma, { assetIds: [asset.id], now: new Date("2026-11-10T17:00:00Z") });

    expect(result).toMatchObject({ priced: 0, suspect: 1 });
    const row = await prisma.assetPrice.findFirstOrThrow({ where: { assetId: asset.id, date: new Date("2026-11-10T00:00:00Z") } });
    expect(row).toMatchObject({ status: "suspect", kind: "intraday", asOf: new Date("2026-11-10T16:55:00Z") });
    expect(Number(row.close)).toBe(61);
  });

  it("writes a quote taken after the session's close as that day's close, replacing the intraday row", async () => {
    const fetchPrices = vi.fn(async () => ok({ date: "2026-11-10", close: 39.5, currency: "BRL", asOf: "2026-11-10T16:55:00Z" }));
    registryMock.chainFor.mockReturnValue([stubProvider("fixtureA", ["stocks"], { fetchPrices })]);

    const asset = await createAsset(`${SYMBOL_PREFIX}L`, "stocks", "BRL", [{ source: "fixtureA", externalId: "l" }]);
    await syncPrices(prisma, { assetIds: [asset.id], now: new Date("2026-11-10T17:00:00Z") });
    expect(await prisma.assetPrice.findFirstOrThrow({ where: { assetId: asset.id } })).toMatchObject({ kind: "intraday" });

    fetchPrices.mockResolvedValueOnce(ok({ date: "2026-11-10", close: 39.8, currency: "BRL", asOf: "2026-11-10T20:07:00Z" }));
    // The market-close pipeline at 22:30Z (19:30 in São Paulo).
    await syncPrices(prisma, { assetIds: [asset.id], now: new Date("2026-11-10T22:30:00Z") });
    const rows = await prisma.assetPrice.findMany({ where: { assetId: asset.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "close", status: "ok", asOf: new Date("2026-11-10T20:07:00Z") });
  });

  it("prices a whole class in one call through a bulk fetchAllPrices leader, falling the rest through the chain", async () => {
    const bulkPoints = new Map([[`${SYMBOL_PREFIX}G`, { date: "2026-11-10", close: 128.4, currency: "BRL" }]]);
    const bulkLeader = stubProvider("bulkLeader", ["fii"], { fetchAllPrices: vi.fn(async () => ({ outcome: "ok" as const, status: 200, data: bulkPoints })) });
    const fallback = stubProvider("fallback", ["fii"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 99, currency: "BRL" })) });
    registryMock.chainFor.mockReturnValue([bulkLeader, fallback]);

    const covered = await createAsset(`${SYMBOL_PREFIX}G`, "fii", "BRL", [{ source: "bulkLeader", externalId: `${SYMBOL_PREFIX}G` }]);
    const missedByBulk = await createAsset(`${SYMBOL_PREFIX}H`, "fii", "BRL", [{ source: "fallback", externalId: "h" }]);

    const result = await syncPrices(prisma, { assetIds: [covered.id, missedByBulk.id] });

    expect(result).toMatchObject({ priced: 2, bySource: { bulkLeader: 1, fallback: 1 } });
    expect(bulkLeader.fetchAllPrices).toHaveBeenCalledOnce();
    expect(fallback.fetchPrices).toHaveBeenCalledOnce();
    expect(await prisma.assetPrice.findFirstOrThrow({ where: { assetId: covered.id } })).toMatchObject({ source: "bulkLeader" });
    expect(await prisma.assetPrice.findFirstOrThrow({ where: { assetId: missedByBulk.id } })).toMatchObject({ source: "fallback" });
  });

  it("honors assetIds scope, leaving other assets untouched", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 10, currency: "BRL" })) });
    registryMock.chainFor.mockReturnValue([providerA]);

    const included = await createAsset(`${SYMBOL_PREFIX}I`, "stocks", "BRL", [{ source: "fixtureA", externalId: "i" }]);
    const excluded = await createAsset(`${SYMBOL_PREFIX}J`, "stocks", "BRL", [{ source: "fixtureA", externalId: "j" }]);

    const result = await syncPrices(prisma, { assetIds: [included.id] });

    expect(result.requested).toBe(1);
    expect(await prisma.assetPrice.findFirst({ where: { assetId: included.id } })).not.toBeNull();
    expect(await prisma.assetPrice.findFirst({ where: { assetId: excluded.id } })).toBeNull();
  });
  it("treats an ok answer with no points as not_found and tries the next provider", async () => {
    const empty = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async (): Promise<FetchOutcome<PricePoint[]>> => ({ outcome: "ok", status: 200, data: [] })) });
    const second = stubProvider("fixtureB", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 12, currency: "BRL" })) });

    const asset = await createAsset(`${SYMBOL_PREFIX}M`, "stocks", "BRL", [
      { source: "fixtureA", externalId: "m" },
      { source: "fixtureB", externalId: "m" },
    ]);
    registryMock.chainFor.mockReturnValue([empty, second]);
    expect(await syncPrices(prisma, { assetIds: [asset.id] })).toMatchObject({ priced: 1, missing: 0, bySource: { fixtureB: 1 } });

    registryMock.chainFor.mockReturnValue([empty]);
    const alone = await syncPrices(prisma, { assetIds: [asset.id] });
    expect(alone).toMatchObject({ priced: 0, missing: 1 });
    expect(alone.issues).toEqual([{ assetId: asset.id, symbol: `${SYMBOL_PREFIX}M`, outcome: "not_found", source: "fixtureA" }]);
  });

  it("skips a provider with no fetchPrices and reports the last provider's failure when several fail", async () => {
    const bulkOnly = stubProvider("bulkOnly", ["stocks"], { capabilities: ["bulk-prices"] });
    const down = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => providerDown("first down")) });
    const limited = stubProvider("fixtureB", ["stocks"], { fetchPrices: vi.fn(async (): Promise<FetchOutcome<PricePoint[]>> => ({ outcome: "rate_limited", status: 429, retryAfterMs: null })) });
    registryMock.chainFor.mockReturnValue([bulkOnly, down, limited]);

    const asset = await createAsset(`${SYMBOL_PREFIX}N`, "stocks", "BRL", [
      { source: "bulkOnly", externalId: "n" },
      { source: "fixtureA", externalId: "n" },
      { source: "fixtureB", externalId: "n" },
    ]);
    const result = await syncPrices(prisma, { assetIds: [asset.id] });
    expect(result.issues).toEqual([{ assetId: asset.id, symbol: `${SYMBOL_PREFIX}N`, outcome: "rate_limited", source: "fixtureB", error: undefined }]);
  });

  it("requests nothing for an empty assetIds scope and never asks a provider", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 10, currency: "BRL" })) });
    registryMock.chainFor.mockReturnValue([providerA]);
    expect(await syncPrices(prisma, { assetIds: [] })).toEqual({ requested: 0, priced: 0, suspect: 0, missing: 0, bySource: {}, providerLatestDate: null, issues: [] });
    expect(providerA.fetchPrices).not.toHaveBeenCalled();
  });

  it("without a scope syncs the active assets and leaves inactive ones alone", async () => {
    const providerA = stubProvider("fixtureA", ["stocks"], { fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 10, currency: "BRL" })) });
    registryMock.chainFor.mockReturnValue([providerA]);
    const active = await createAsset(`${SYMBOL_PREFIX}O`, "stocks", "BRL", [{ source: "fixtureA", externalId: "o" }]);
    const inactive = await createAsset(`${SYMBOL_PREFIX}P`, "stocks", "BRL", [{ source: "fixtureA", externalId: "p" }]);
    await prisma.asset.update({ where: { id: inactive.id }, data: { isActive: false } });

    // The dev database holds other assets: confine the unscoped query to this test's own.
    const confined = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "asset") return Reflect.get(target, prop);
        return { findMany: (args: Parameters<typeof prisma.asset.findMany>[0]) => target.asset.findMany({ ...args, where: { ...args?.where, symbol: { startsWith: SYMBOL_PREFIX } } }) };
      },
    }) as PrismaClient;

    const result = await syncPrices(confined);

    expect(result).toMatchObject({ requested: 1, priced: 1 });
    expect(await prisma.assetPrice.count({ where: { assetId: active.id } })).toBe(1);
    expect(await prisma.assetPrice.count({ where: { assetId: inactive.id } })).toBe(0);
  });

  it("falls a whole class back to the per-asset chain when its bulk leader is down", async () => {
    const bulkLeader = stubProvider("bulkLeader", ["fii"], {
      fetchAllPrices: vi.fn(async (): Promise<FetchOutcome<Map<string, PricePoint>>> => ({ outcome: "provider_down", status: 503, error: "bulk down" })),
      fetchPrices: vi.fn(async () => ok({ date: "2026-11-10", close: 130, currency: "BRL" })),
    });
    registryMock.chainFor.mockReturnValue([bulkLeader]);

    const asset = await createAsset(`${SYMBOL_PREFIX}Q`, "fii", "BRL", [{ source: "bulkLeader", externalId: "q" }]);
    const result = await syncPrices(prisma, { assetIds: [asset.id], now: new Date("2026-11-12T12:00:00Z") });

    expect(bulkLeader.fetchAllPrices).toHaveBeenCalledWith("2026-11-12");
    expect(bulkLeader.fetchPrices).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ priced: 1, bySource: { bulkLeader: 1 } });
  });

  it("reports a bulk point acceptPrice refuses as a rejected issue and writes nothing", async () => {
    const bulkPoints = new Map([["q", { date: "2026-11-10", close: 128.4, currency: "USD" }]]);
    const bulkLeader = stubProvider("bulkLeader", ["fii"], { fetchAllPrices: vi.fn(async () => ({ outcome: "ok" as const, status: 200, data: bulkPoints })) });
    registryMock.chainFor.mockReturnValue([bulkLeader]);

    const asset = await createAsset(`${SYMBOL_PREFIX}R`, "fii", "BRL", [{ source: "bulkLeader", externalId: "q" }]);
    const result = await syncPrices(prisma, { assetIds: [asset.id] });

    expect(result).toMatchObject({ requested: 1, priced: 0, missing: 1 });
    expect(result.issues).toEqual([
      { assetId: asset.id, symbol: `${SYMBOL_PREFIX}R`, outcome: "rejected", source: "bulkLeader", error: "moeda USD não corresponde à moeda do ativo (BRL)" },
    ]);
    expect(await prisma.assetPrice.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it("tracks the newest date it priced across assets as the provider's latest", async () => {
    const dates = ["2026-11-09", "2026-11-10"];
    const fetchPrices = vi.fn(async () => ok({ date: dates.shift() ?? "2026-11-10", close: 10, currency: "BRL" }));
    registryMock.chainFor.mockReturnValue([stubProvider("fixtureA", ["stocks"], { fetchPrices })]);
    const first = await createAsset(`${SYMBOL_PREFIX}S`, "stocks", "BRL", [{ source: "fixtureA", externalId: "s" }]);
    const second = await createAsset(`${SYMBOL_PREFIX}T`, "stocks", "BRL", [{ source: "fixtureA", externalId: "t" }]);
    const result = await syncPrices(prisma, { assetIds: [first.id, second.id] });
    expect(result.priced).toBe(2);
    expect(result.providerLatestDate).toEqual(new Date("2026-11-10T00:00:00Z"));
  });
});
