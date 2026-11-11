import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { resolveAsset } from "../resolve-asset";

// A distinctive prefix so cleanup never touches real data, and so parallel
// test files never collide on the same Asset row.
const SYMBOL_PREFIX = "ZZTEST";

afterEach(async () => {
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: SYMBOL_PREFIX } } });
});

describe("resolveAsset", () => {
  it("links a B3 stock to brapi and Yahoo's .SA fallback, always in BRL", async () => {
    const ticker = `${SYMBOL_PREFIX}PETR4`;
    const result = await resolveAsset(prisma, { ticker, assetClass: "stocks", currency: "USD" });
    expect(result).toMatchObject({ linked: true });
    if (!result.linked) throw new Error("expected linked");
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.assetId }, include: { sourceRefs: true } });
    expect(asset).toMatchObject({ symbol: ticker, assetClass: "stocks", currency: "BRL" });
    expect(asset.sourceRefs.map((r) => [r.source, r.externalId]).sort()).toEqual([
      ["brapi", ticker],
      ["yahoo", `${ticker}.SA`],
    ]);
  });

  it("routes a plain 'etf' holding by the ticker's own shape", async () => {
    const brTicker = `${SYMBOL_PREFIX}BOVA11`;
    const br = await resolveAsset(prisma, { ticker: brTicker, assetClass: "etf", currency: "BRL" });
    expect(br).toMatchObject({ linked: true });
    if (!br.linked) throw new Error("expected linked");
    expect(await prisma.asset.findUniqueOrThrow({ where: { id: br.assetId } })).toMatchObject({ currency: "BRL" });

    const usTicker = `${SYMBOL_PREFIX}VOO`;
    const intl = await resolveAsset(prisma, { ticker: usTicker, assetClass: "etf", currency: "USD" });
    expect(intl).toMatchObject({ linked: true });
    if (!intl.linked) throw new Error("expected linked");
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: intl.assetId }, include: { sourceRefs: true } });
    expect(asset).toMatchObject({ currency: "USD" });
    expect(asset.sourceRefs).toEqual([expect.objectContaining({ source: "yahoo", externalId: usTicker })]);
  });

  it("links a supported crypto to coingecko, keyed by the holding's currency", async () => {
    // CRYPTO_SYMBOL_TO_COINGECKO_ID only knows the real "BTC" symbol, not a prefixed one; the SYMBOL_PREFIX cleanup in afterEach doesn't cover it, so this test deletes its own row.
    const result = await resolveAsset(prisma, { ticker: "BTC", assetClass: "crypto", currency: "brl" });
    expect(result).toMatchObject({ linked: true });
    if (!result.linked) throw new Error("expected linked");
    try {
      const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.assetId }, include: { sourceRefs: true } });
      expect(asset).toMatchObject({ symbol: "BTC", assetClass: "crypto", currency: "BRL" });
      expect(asset.sourceRefs).toEqual([expect.objectContaining({ source: "coingecko", externalId: "bitcoin:brl" })]);
    } finally {
      await prisma.asset.delete({ where: { id: result.assetId } });
    }
  });

  it("leaves an unsupported crypto symbol unmatched", async () => {
    const result = await resolveAsset(prisma, { ticker: "NOTACOIN", assetClass: "crypto", currency: "USD" });
    expect(result).toEqual({ linked: false, reason: "unmatched" });
  });

  it("leaves fixed income and savings without a source", async () => {
    expect(await resolveAsset(prisma, { ticker: "CDB123", assetClass: "fixed_income", currency: "BRL" })).toEqual({ linked: false, reason: "no_source" });
    expect(await resolveAsset(prisma, { ticker: "POUP", assetClass: "savings", currency: "BRL" })).toEqual({ linked: false, reason: "no_source" });
  });

  it("leaves a holding with no ticker unlinked", async () => {
    expect(await resolveAsset(prisma, { ticker: null, assetClass: "stocks", currency: "BRL" })).toEqual({ linked: false, reason: "no_ticker" });
    expect(await resolveAsset(prisma, { ticker: "  ", assetClass: "stocks", currency: "BRL" })).toEqual({ linked: false, reason: "no_ticker" });
  });

  it("is idempotent: resolving the same ticker/class/currency twice returns the same Asset", async () => {
    const ticker = `${SYMBOL_PREFIX}HGLG11`;
    const first = await resolveAsset(prisma, { ticker, assetClass: "fii", currency: "BRL" });
    const second = await resolveAsset(prisma, { ticker, assetClass: "fii", currency: "BRL" });
    expect(first).toEqual(second);
    const count = await prisma.asset.count({ where: { symbol: ticker } });
    expect(count).toBe(1);
  });
});
