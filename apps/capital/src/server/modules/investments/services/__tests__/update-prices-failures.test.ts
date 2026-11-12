import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { marketFor } from "@capital/server/modules/market-data/lib/calendar";
import { createHolding } from "../portfolio";
import { updateAllPrices } from "../update-prices";

const USER = "test-user-inv-updfail-001";
const SYMBOL_PREFIX = "ZZUPDF";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: SYMBOL_PREFIX } } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

async function pricedHolding(symbol: string, close: number) {
  const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: symbol, name: symbol, currentPrice: 1 }, prisma);
  const asset = await prisma.asset.create({ data: { symbol, assetClass: "stocks", market: marketFor("stocks", symbol) ?? "B3", currency: "BRL" } });
  await prisma.assetPrice.create({ data: { assetId: asset.id, date: new Date("2026-11-10T00:00:00Z"), close, source: "brapi", status: "ok" } });
  await prisma.investmentHolding.update({ where: { id: holding.id }, data: { assetId: asset.id, priceSource: "auto", currentPrice: 1 } });
  return holding;
}

/** `prisma`, except that writing the given holding's row fails. */
function dbFailingWriteOf(holdingId: string) {
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop !== "investmentHolding") {
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return new Proxy(target.investmentHolding, {
        get(delegate, method) {
          const value = Reflect.get(delegate, method);
          if (method !== "update") return typeof value === "function" ? value.bind(delegate) : value;
          return (args: { where: { id: string } }) => (args.where.id === holdingId ? Promise.reject(new Error("disk full")) : delegate.update(args as never));
        },
      });
    },
  });
}

describe("updateAllPrices when a write fails", () => {
  it("counts the failure, names the holding, and still updates the others", async () => {
    const broken = await pricedHolding(`${SYMBOL_PREFIX}1`, 12.5);
    const fine = await pricedHolding(`${SYMBOL_PREFIX}2`, 20);

    const result = await updateAllPrices(dbFailingWriteOf(broken.id), { userId: USER });

    expect(result).toMatchObject({ totalHoldings: 2, updated: 1, failed: 1, missing: [] });
    expect(result.issues).toEqual([{ holdingId: broken.id, ticker: `${SYMBOL_PREFIX}1`, reason: "write_failed" }]);
    expect(result.bySource).toEqual({ brapi: 2 });
    expect(console.error).toHaveBeenCalledWith(`[PriceUpdate] Failed to update holding ${broken.id}:`, expect.any(Error));
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: broken.id } })).currentPrice).toBe(1);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: fine.id } })).currentPrice).toBe(20);
  });
});
