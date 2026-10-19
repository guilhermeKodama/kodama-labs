import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { createHolding, recordOperation } from "../../../investments/services/portfolio";
import { addInvestmentAsset, adjustPosition, listInvestmentPositions, updateHoldingPrice } from "../investments";

const USER = "test-user-mcp-investments-001";
const OTHER = "test-user-mcp-investments-002";
let f: LedgerFixture;
let holdingId: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  const h = await prisma.investmentHolding.create({
    data: { accountId: f.broker, ticker: "PMLL11", name: "Maxi Renda FII", assetClass: "fii", currency: "BRL", currentQuantity: 164, averageCost: 102.5, totalInvested: 16810, currentPrice: 105.2 },
  });
  holdingId = h.id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("MCP investment tools", () => {
  it("lists positions with value and unrealized gain", async () => {
    const { positions } = await listInvestmentPositions(USER, prisma);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ ticker: "PMLL11", currentQuantity: 164, accountName: "XP", accountId: f.broker, entityId: f.pfId, closedAt: null });
    const pjOnly = await listInvestmentPositions(USER, prisma, { entityId: f.pjId });
    expect(pjOnly.positions).toHaveLength(0);
    const onBroker = await listInvestmentPositions(USER, prisma, { accountId: f.broker });
    expect(onBroker.positions.map((p) => p.id)).toEqual([holdingId]);
    expect(positions[0].currentValue).toBeCloseTo(17252.8, 2);
    expect(positions[0].unrealizedGain).toBeCloseTo(442.8, 2);
  });

  it("finds a closed holding by ticker when includeClosed is set", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "bdr", ticker: "GOGL34", name: "Alphabet" }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 8, pricePerUnit: 50, totalAmount: 400, date: "2026-07-01" }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 8, pricePerUnit: 55, totalAmount: 440, date: "2026-08-05" }, prisma);
    expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ currentQuantity: 0, isActive: false });

    expect((await listInvestmentPositions(USER, prisma, { ticker: "GOGL34" })).positions).toEqual([]);
    expect((await listInvestmentPositions(USER, prisma)).positions.map((p) => p.ticker)).not.toContain("GOGL34");

    const found = await listInvestmentPositions(USER, prisma, { ticker: "gogl34", includeClosed: true });
    expect(found.positions).toHaveLength(1);
    expect(found.positions[0]).toMatchObject({
      id: h.id,
      ticker: "GOGL34",
      assetClass: "bdr",
      allocationClass: "international",
      currentQuantity: 0,
      closedAt: "2026-08-05",
    });
    expect((await listInvestmentPositions(USER, prisma, { query: "gogl", includeClosed: true })).positions.map((p) => p.id)).toContain(h.id);
    expect((await listInvestmentPositions(OTHER, prisma, { ticker: "GOGL34", includeClosed: true })).positions).toEqual([]);
  });

  it("adjusts a position and records an adjustment operation", async () => {
    const r = await adjustPosition(USER, { holdingId, currentQuantity: 174, averageCost: 102 }, prisma);
    expect(r).toEqual({ success: true, holdingId, newQuantity: 174, newAverageCost: 102, newTotalInvested: 17748 });
    const ops = await prisma.investmentOperation.findMany({ where: { holdingId } });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "adjustment", quantity: 174, notes: "Manual adjustment via MCP" });
  });

  it("rejects unknown and foreign holdings", async () => {
    await expect(adjustPosition(USER, { holdingId: "00000000-0000-0000-0000-000000000000", currentQuantity: 1, averageCost: 1 }, prisma)).rejects.toThrow(/not found/);
    await expect(adjustPosition(OTHER, { holdingId, currentQuantity: 1, averageCost: 1 }, prisma)).rejects.toThrow(/not found/);
  });

  it("adds assets only to the user's brokerage accounts", async () => {
    const r = await addInvestmentAsset(USER, { accountId: f.broker, ticker: "PVBI11", name: "VBI Prime", assetClass: "fii" }, prisma);
    expect(r).toMatchObject({ ticker: "PVBI11", assetClass: "fii", currency: "BRL" });
    await expect(addInvestmentAsset(USER, { accountId: f.pfChecking, name: "X", assetClass: "fii" }, prisma)).rejects.toThrow(/Investment account not found/);
    await expect(addInvestmentAsset(OTHER, { accountId: f.broker, name: "X", assetClass: "fii" }, prisma)).rejects.toThrow(/Investment account not found/);
  });

  it("sets a price from a total value and leaves the cost basis", async () => {
    const priced = await updateHoldingPrice(USER, { holdingId, totalValue: 50000, date: "2026-10-15" }, prisma);
    expect(priced.currentPrice).toBeCloseTo(50000 / 164, 8);
    expect(priced).toMatchObject({ currentQuantity: 164, averageCost: 102.5, totalInvested: 16810 });
    expect(formatDateOnly(new Date(priced.lastPriceUpdate!))).toBe("2026-10-15");
    const perUnit = await updateHoldingPrice(USER, { holdingId, price: 110 }, prisma);
    expect(perUnit.currentPrice).toBe(110);
    expect(perUnit.totalInvested).toBe(16810);
    expect(perUnit.averageCost).toBe(102.5);
    await expect(updateHoldingPrice(USER, { holdingId, price: 1, totalValue: 2 }, prisma)).rejects.toMatchObject({ status: 422, code: "holding.price_choice" });
    await expect(updateHoldingPrice(USER, { holdingId }, prisma)).rejects.toMatchObject({ status: 422, code: "holding.price_choice" });
    await expect(updateHoldingPrice(USER, { holdingId, price: -1 }, prisma)).rejects.toMatchObject({ status: 422, code: "holding.price_choice" });
    await expect(updateHoldingPrice(USER, { holdingId, price: 1, date: "2099-01-01" }, prisma)).rejects.toMatchObject({ status: 422, code: "holding.future_date" });
    const zero = await updateHoldingPrice(USER, { holdingId, price: 0 }, prisma);
    expect(zero.currentPrice).toBe(0);
    expect(zero.totalInvested).toBe(16810);
    const zeroValue = await updateHoldingPrice(USER, { holdingId, totalValue: 0 }, prisma);
    expect(zeroValue.currentPrice).toBe(0);
    expect(zeroValue.totalInvested).toBe(16810);
    await expect(updateHoldingPrice(OTHER, { holdingId, price: 1 }, prisma)).rejects.toMatchObject({ status: 404, code: "holding.not_found" });
  });

  it("rejects a total value when the position has no units", async () => {
    await prisma.investmentHolding.update({ where: { id: holdingId }, data: { currentQuantity: 0, totalInvested: 0, averageCost: 0 } });
    await expect(updateHoldingPrice(USER, { holdingId, totalValue: 50000 }, prisma)).rejects.toMatchObject({ status: 422, code: "holding.no_units" });
    const priced = await updateHoldingPrice(USER, { holdingId, price: 10 }, prisma);
    expect(priced.currentPrice).toBe(10);
    expect(priced.totalInvested).toBe(0);
  });
});
