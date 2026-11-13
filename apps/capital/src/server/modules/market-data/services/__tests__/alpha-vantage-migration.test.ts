import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

/**
 * The Yahoo → Alpha Vantage data fix. Runs inside a transaction that rolls
 * back, so a second execution of this file (and any real Yahoo rows already
 * in the database) is left as it was. The SQL itself is what production runs.
 */
const USER = "test-user-alpha-vantage-migration-001";
const migrationSql = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../prisma/migrations/20261113120000_alpha_vantage_source/migration.sql"),
  "utf8",
);

class Rollback extends Error {}

let f: LedgerFixture;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: "ZZAV" } } });
  await deleteLedgerFixture(prisma, USER);
});

describe("alpha vantage source migration", () => {
  it("rewrites Yahoo refs, LSE symbols and Yahoo-only etf holdings once", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const vuaa = await tx.asset.create({
          data: { symbol: "ZZAVVUAA", assetClass: "etf", market: "B3", currency: "USD", sourceRefs: { create: { source: "yahoo", externalId: "VUAA" } } },
        });
        const cndx = await tx.asset.create({
          data: { symbol: "ZZAVCNDX", assetClass: "etf", market: "US", currency: "USD", sourceRefs: { create: { source: "yahoo", externalId: "CNDX.L" } } },
        });
        const spy = await tx.asset.create({
          data: { symbol: "ZZAVSPY", assetClass: "international_etf", market: "US", currency: "USD", sourceRefs: { create: { source: "yahoo", externalId: "spy" } } },
        });
        const petr = await tx.asset.create({
          data: {
            symbol: "ZZAVPETR4",
            assetClass: "stocks",
            market: "B3",
            currency: "BRL",
            sourceRefs: { create: [{ source: "brapi", externalId: "ZZAVPETR4" }, { source: "yahoo", externalId: "ZZAVPETR4.SA" }] },
          },
        });
        const bova = await tx.asset.create({
          data: {
            symbol: "ZZAVBOVA11",
            assetClass: "etf",
            market: "B3",
            currency: "BRL",
            sourceRefs: { create: [{ source: "brapi", externalId: "ZZAVBOVA11" }, { source: "yahoo", externalId: "bova11.sa" }] },
          },
        });
        const folded = await tx.asset.create({
          data: {
            symbol: "ZZAVFOLD",
            assetClass: "international_stocks",
            market: "US",
            currency: "USD",
            sourceRefs: { create: [{ source: "alpha_vantage", externalId: "OLD" }, { source: "yahoo", externalId: "VOO" }] },
          },
        });
        const saOnly = await tx.asset.create({
          data: {
            symbol: "ZZAVSA11",
            assetClass: "etf",
            market: "B3",
            currency: "BRL",
            sourceRefs: { create: { source: "yahoo", externalId: "ZZAVSA11.SA" } },
          },
        });
        await tx.assetPrice.create({ data: { assetId: vuaa.id, date: new Date("2026-11-10T00:00:00Z"), close: 140, source: "yahoo", status: "ok" } });

        const vuaaHolding = await tx.investmentHolding.create({
          data: { accountId: f.broker, assetClass: "etf", ticker: "ZZAVVUAA", name: "VUAA", currency: "USD", assetId: vuaa.id },
        });
        const spyHolding = await tx.investmentHolding.create({
          data: { accountId: f.broker, assetClass: "etf", ticker: "ZZAVSPY", name: "SPY", currency: "USD", assetId: spy.id },
        });
        const bovaHolding = await tx.investmentHolding.create({
          data: { accountId: f.broker, assetClass: "etf", ticker: "ZZAVBOVA11", name: "BOVA", currency: "BRL", assetId: bova.id },
        });
        const petrHolding = await tx.investmentHolding.create({
          data: { accountId: f.broker, assetClass: "stocks", ticker: "ZZAVPETR4", name: "PETR", currency: "BRL", assetId: petr.id },
        });
        const saHolding = await tx.investmentHolding.create({
          data: { accountId: f.broker, assetClass: "etf", ticker: "ZZAVSA11", name: "SA", currency: "BRL", assetId: saOnly.id },
        });

        await tx.$executeRawUnsafe(migrationSql);

        expect(await tx.asset.findUniqueOrThrow({ where: { id: vuaa.id } })).toMatchObject({ assetClass: "international_etf", market: "US" });
        expect(await tx.asset.findUniqueOrThrow({ where: { id: cndx.id } })).toMatchObject({ assetClass: "international_etf", market: "US" });
        expect(await tx.assetSourceRef.findMany({ where: { assetId: vuaa.id } })).toEqual([expect.objectContaining({ source: "alpha_vantage", externalId: "VUAA.LON" })]);
        expect(await tx.assetSourceRef.findMany({ where: { assetId: cndx.id } })).toEqual([expect.objectContaining({ source: "alpha_vantage", externalId: "CNDX.LON" })]);
        expect(await tx.assetSourceRef.findMany({ where: { assetId: spy.id } })).toEqual([expect.objectContaining({ source: "alpha_vantage", externalId: "SPY" })]);
        expect(await tx.assetSourceRef.findMany({ where: { assetId: petr.id }, orderBy: { source: "asc" } })).toEqual([expect.objectContaining({ source: "brapi", externalId: "ZZAVPETR4" })]);
        expect(await tx.asset.findUniqueOrThrow({ where: { id: bova.id } })).toMatchObject({ assetClass: "etf", market: "B3" });
        expect(await tx.assetSourceRef.findMany({ where: { assetId: bova.id } })).toEqual([expect.objectContaining({ source: "brapi", externalId: "ZZAVBOVA11" })]);
        expect(await tx.assetSourceRef.findMany({ where: { assetId: folded.id } })).toEqual([expect.objectContaining({ source: "alpha_vantage", externalId: "VOO" })]);
        expect(await tx.asset.findUniqueOrThrow({ where: { id: saOnly.id } })).toMatchObject({ assetClass: "etf", market: "B3" });
        expect(await tx.assetSourceRef.count({ where: { assetId: saOnly.id } })).toBe(0);
        expect(await tx.assetPrice.findFirstOrThrow({ where: { assetId: vuaa.id } })).toMatchObject({ source: "alpha_vantage" });

        const vuaaAfter = await tx.investmentHolding.findUniqueOrThrow({ where: { id: vuaaHolding.id } });
        expect(vuaaAfter.assetClass).toBe("international_etf");
        expect(vuaaAfter.updatedAt).toEqual(vuaaHolding.updatedAt);
        expect((await tx.investmentHolding.findUniqueOrThrow({ where: { id: spyHolding.id } })).assetClass).toBe("international_etf");
        expect((await tx.investmentHolding.findUniqueOrThrow({ where: { id: bovaHolding.id } })).assetClass).toBe("etf");
        expect((await tx.investmentHolding.findUniqueOrThrow({ where: { id: petrHolding.id } })).assetClass).toBe("stocks");
        const saAfter = await tx.investmentHolding.findUniqueOrThrow({ where: { id: saHolding.id } });
        expect(saAfter.assetClass).toBe("etf");
        expect(saAfter.updatedAt).toEqual(saHolding.updatedAt);

        await tx.$executeRawUnsafe(migrationSql);
        expect(await tx.assetSourceRef.findMany({ where: { assetId: vuaa.id } })).toEqual([expect.objectContaining({ source: "alpha_vantage", externalId: "VUAA.LON" })]);
        expect(await tx.assetSourceRef.count({ where: { assetId: { in: [vuaa.id, cndx.id, spy.id, petr.id, bova.id, folded.id, saOnly.id] }, source: "yahoo" } })).toBe(0);
        expect((await tx.investmentHolding.findUniqueOrThrow({ where: { id: vuaaHolding.id } })).updatedAt).toEqual(vuaaHolding.updatedAt);

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
