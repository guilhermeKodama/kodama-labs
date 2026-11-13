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
  it("links a B3 stock to brapi, in BRL", async () => {
    const ticker = `${SYMBOL_PREFIX}PETR4`;
    const result = await resolveAsset(prisma, { ticker, assetClass: "stocks", currency: "BRL" });
    expect(result).toMatchObject({ linked: true });
    if (!result.linked) throw new Error("expected linked");
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.assetId }, include: { sourceRefs: true } });
    expect(asset).toMatchObject({ symbol: ticker, assetClass: "stocks", market: "B3", currency: "BRL" });
    expect(asset.sourceRefs.map((r) => [r.source, r.externalId]).sort()).toEqual([["brapi", ticker]]);
  });

  it("never links across currencies: a B3 ticker held in USD, a US ticker held in BRL", async () => {
    expect(await resolveAsset(prisma, { ticker: `${SYMBOL_PREFIX}VALE3`, assetClass: "stocks", currency: "USD" })).toEqual({ linked: false, reason: "currency_mismatch", marketCurrency: "BRL" });
    expect(await resolveAsset(prisma, { ticker: `${SYMBOL_PREFIX}AAPL`, assetClass: "international_stocks", currency: "BRL" })).toEqual({ linked: false, reason: "currency_mismatch", marketCurrency: "USD" });
    expect(await prisma.asset.count({ where: { symbol: { in: [`${SYMBOL_PREFIX}VALE3`, `${SYMBOL_PREFIX}AAPL`] } } })).toBe(0);
  });

  it("trusts the holding's currency for a non-US listing and stores Alpha Vantage's .LON symbol", async () => {
    const ticker = `${SYMBOL_PREFIX}VWRL.L`;
    const result = await resolveAsset(prisma, { ticker, assetClass: "international_etf", currency: "GBP" });
    expect(result).toMatchObject({ linked: true });
    if (!result.linked) throw new Error("expected linked");
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.assetId }, include: { sourceRefs: true } });
    expect(asset).toMatchObject({ currency: "GBP" });
    expect(asset.sourceRefs).toEqual([expect.objectContaining({ source: "alpha_vantage", externalId: `${SYMBOL_PREFIX}VWRL.LON` })]);
  });

  it("links one instrument held under two classes to a single Asset", async () => {
    const ticker = `${SYMBOL_PREFIX}BOVA11`;
    const asEtf = await resolveAsset(prisma, { ticker, assetClass: "etf", currency: "BRL" });
    const asStock = await resolveAsset(prisma, { ticker, assetClass: "stocks", currency: "BRL" });
    expect(asEtf).toEqual(asStock);
    expect(await prisma.asset.count({ where: { symbol: ticker } })).toBe(1);
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
    expect(asset.sourceRefs).toEqual([expect.objectContaining({ source: "alpha_vantage", externalId: usTicker })]);
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

  it("prices a crypto in USD when the holding names no currency", async () => {
    // Only the real "ETH" symbol is supported: remove the row afterwards only if this test created it.
    const existed = !!(await prisma.asset.findFirst({ where: { market: "CRYPTO", symbol: "ETH", currency: "USD" } }));
    const result = await resolveAsset(prisma, { ticker: "ETH", assetClass: "crypto", currency: "  " });
    expect(result).toMatchObject({ linked: true });
    if (!result.linked) throw new Error("expected linked");
    try {
      const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.assetId }, include: { sourceRefs: true } });
      expect(asset).toMatchObject({ symbol: "ETH", market: "CRYPTO", currency: "USD" });
      expect(asset.sourceRefs).toEqual([expect.objectContaining({ source: "coingecko", externalId: "ethereum:usd" })]);
    } finally {
      if (!existed) await prisma.asset.delete({ where: { id: result.assetId } });
    }
  });

  it("defaults a US listing held without a currency to USD, and a B3 one to BRL", async () => {
    const us = await resolveAsset(prisma, { ticker: `${SYMBOL_PREFIX}MSFT`, assetClass: "international_stocks", currency: "" });
    if (!us.linked) throw new Error("expected linked");
    expect(await prisma.asset.findUniqueOrThrow({ where: { id: us.assetId } })).toMatchObject({ market: "US", currency: "USD" });

    const br = await resolveAsset(prisma, { ticker: `${SYMBOL_PREFIX}ITUB4`, assetClass: "stocks", currency: "" });
    if (!br.linked) throw new Error("expected linked");
    expect(await prisma.asset.findUniqueOrThrow({ where: { id: br.assetId } })).toMatchObject({ market: "B3", currency: "BRL" });
  });

  it("updates a source ref's external id when the same instrument is resolved again", async () => {
    const ticker = `${SYMBOL_PREFIX}WEGE3`;
    const first = await resolveAsset(prisma, { ticker, assetClass: "stocks", currency: "BRL" });
    if (!first.linked) throw new Error("expected linked");
    await prisma.assetSourceRef.update({ where: { assetId_source: { assetId: first.assetId, source: "brapi" } }, data: { externalId: "stale" } });
    await resolveAsset(prisma, { ticker, assetClass: "stocks", currency: "BRL" });
    expect(await prisma.assetSourceRef.findUniqueOrThrow({ where: { assetId_source: { assetId: first.assetId, source: "brapi" } } })).toMatchObject({ externalId: ticker });
  });

  it("leaves a class this resolver does not know unmatched", async () => {
    const result = await resolveAsset(prisma, { ticker: `${SYMBOL_PREFIX}X`, assetClass: "commodity" as never, currency: "BRL" });
    expect(result).toEqual({ linked: false, reason: "unmatched" });
    expect(await prisma.asset.count({ where: { symbol: `${SYMBOL_PREFIX}X` } })).toBe(0);
  });
});
