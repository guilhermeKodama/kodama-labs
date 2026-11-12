import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AssetClass } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { replayPosition } from "@capital/server/modules/investments/lib/holding-position";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { recordInvestmentContribution, recordInvestmentRedemption } from "../holding-cashflow";
import { recordOperation } from "../portfolio";

const USER = "test-user-inv-cashflowedge-001";
const DAY = "2026-10-15";
let f: LedgerFixture;

beforeEach(async () => {
  // 1 USD = 5 BRL.
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

interface HoldingSpec {
  accountId?: string;
  name?: string;
  assetClass?: AssetClass;
  ticker?: string | null;
  currency?: string;
  quantity?: number;
  cost?: number;
  price?: number | null;
  /** An opening adjustment that matches the stored position (default), none, or one created far in the future. */
  opening?: boolean | Date;
}

async function holding(spec: HoldingSpec = {}) {
  const quantity = spec.quantity ?? 1;
  const cost = spec.cost ?? 1000;
  const created = await prisma.investmentHolding.create({
    data: {
      accountId: spec.accountId ?? f.broker,
      name: spec.name ?? "Caixinha Teste",
      ticker: spec.ticker ?? null,
      assetClass: spec.assetClass ?? "fixed_income",
      currency: spec.currency ?? "BRL",
      currentQuantity: quantity,
      averageCost: quantity > 0 ? cost / quantity : 0,
      totalInvested: cost,
      currentPrice: spec.price === undefined ? cost : spec.price,
    },
  });
  if (spec.opening !== false && quantity > 0) {
    await prisma.investmentOperation.create({
      data: {
        holdingId: created.id,
        type: "adjustment",
        quantity,
        pricePerUnit: cost / quantity,
        totalAmount: cost,
        fees: 0,
        date: parseLocalDate("2026-08-14"),
        adjustmentMode: "absolute",
        notes: "opening",
        ...(spec.opening instanceof Date && { createdAt: spec.opening }),
      },
    });
  }
  return created;
}

const stock = (spec: HoldingSpec = {}) => holding({ assetClass: "stocks", name: "Petrobras", ticker: "PETR4", quantity: 10, cost: 200, price: 25, ...spec });

const contribute = (holdingId: string, patch: Partial<Parameters<typeof recordInvestmentContribution>[1]> = {}) =>
  recordInvestmentContribution(USER, { holdingId, cashAccountId: f.pfChecking, amount: 1000, date: DAY, ...patch }, prisma);
const redeem = (holdingId: string, patch: Partial<Parameters<typeof recordInvestmentRedemption>[1]> = {}) =>
  recordInvestmentRedemption(USER, { holdingId, cashAccountId: f.pfChecking, amount: 400, date: DAY, ...patch }, prisma);

const opsOf = (holdingId: string) => prisma.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });

async function expectReplayMatches(holdingId: string) {
  const [row, ops] = await Promise.all([prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } }), opsOf(holdingId)]);
  const replayed = replayPosition(ops);
  expect(replayed.quantity).toBeCloseTo(row.currentQuantity, 6);
  expect(replayed.cost).toBeCloseTo(row.totalInvested, 2);
  return { row, ops };
}

describe("contribution input checks", () => {
  it("refuses an amount that is not positive, writing nothing", async () => {
    const h = await holding();
    for (const amount of [0, -10]) {
      await expect(contribute(h.id, { amount })).rejects.toMatchObject({ status: 422, code: "rebalance.invalid_amount" });
    }
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
  });

  it("refuses a cash account that is not a checking or cash account, or is archived", async () => {
    const h = await holding();
    await expect(contribute(h.id, { cashAccountId: f.broker })).rejects.toMatchObject({ status: 422, code: "aporte.source_invalid" });
    await expect(contribute(h.id, { cashAccountId: f.card })).rejects.toMatchObject({ code: "aporte.source_invalid" });
    const old = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Antiga", currency: "BRL", archivedAt: new Date() } });
    await expect(contribute(h.id, { cashAccountId: old.id })).rejects.toMatchObject({ status: 422, code: "account.archived", params: { name: "Antiga" } });
    // A cash account works like a checking one.
    const wallet = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Carteira", currency: "BRL" } });
    expect(await contribute(h.id, { cashAccountId: wallet.id })).toMatchObject({ duplicate: false, amount: 1000 });
  });

  it("converts a BRL amount into the holding's currency at today's rate when no received amount is given or it is zero", async () => {
    const usdBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Avenue", currency: "USD" } });
    const h = await holding({ accountId: usdBroker.id, currency: "USD", cost: 1000 });
    const converted = await contribute(h.id, { amount: 500 });
    expect(converted.amount).toBe(100);
    const zero = await contribute(h.id, { amount: 1000, toAmount: 0, date: "2026-10-16" });
    expect(zero.amount).toBe(200);
    expect((await accountBalances(USER, prisma, [usdBroker.id])).get(usdBroker.id)).toBeCloseTo(0, 2);
    expect((await accountBalances(USER, prisma, [f.pfChecking])).get(f.pfChecking)).toBeCloseTo(-1500, 2);
  });

  it("keeps a note that already ends with the by_value marker as it is", async () => {
    const h = await holding();
    const marked = await contribute(h.id, { notes: "lote 1\nby_value" });
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: marked.operationId } })).notes).toBe("lote 1\nby_value");
    const bare = await contribute(h.id, { notes: "  by_value ", amount: 1100 });
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: bare.operationId } })).notes).toBe("by_value");
    const plain = await contribute(h.id, { amount: 1200 });
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: plain.operationId } })).notes).toBe("by_value");
  });

  it("reports a repeated aporte that has no transfer behind it with no transfer groups", async () => {
    const h = await holding();
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 0, totalAmount: 1000, date: DAY }, prisma);
    const repeat = await contribute(h.id);
    expect(repeat).toMatchObject({ duplicate: true, operationId: buy.operation.id, batchId: null, transferGroupId: null, transferGroupIds: [] });
  });
});

describe("by-units contributions", () => {
  it("derives the missing half of quantity and price, or the current price, and keeps the amount", async () => {
    const h = await stock();
    const byQuantity = await contribute(h.id, { amount: 100, date: "2026-10-01", quantity: 4 });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: byQuantity.operationId } })).toMatchObject({ quantity: 4, pricePerUnit: 25, totalAmount: 100 });
    const byPrice = await contribute(h.id, { amount: 100, date: "2026-10-02", price: 20 });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: byPrice.operationId } })).toMatchObject({ quantity: 5, pricePerUnit: 20 });
    const byCurrent = await contribute(h.id, { amount: 100, date: "2026-10-03" });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: byCurrent.operationId } })).toMatchObject({ quantity: 4, pricePerUnit: 25 });
    expect(byCurrent).toMatchObject({ mode: "by_units", quantity: 10 + 4 + 5 + 4, totalInvested: 500 });
  });

  it("refuses a quantity times price that does not match the amount, or a price or quantity that is not positive", async () => {
    const h = await stock();
    await expect(contribute(h.id, { amount: 100, quantity: 2, price: 40 })).rejects.toMatchObject({ status: 422, code: "holding.amount_mismatch" });
    await expect(contribute(h.id, { amount: 100, quantity: 2, price: 0 })).rejects.toMatchObject({ code: "holding.amount_mismatch" });
    await expect(contribute(h.id, { amount: 100, quantity: 0 })).rejects.toMatchObject({ status: 422, code: "holding.units_required" });
    await expect(contribute(h.id, { amount: 100, price: 0 })).rejects.toMatchObject({ code: "holding.units_required" });
    // Within a cent is a match.
    expect(await contribute(h.id, { amount: 100, quantity: 3, price: 33.333 })).toMatchObject({ mode: "by_units", quantity: 13 });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id, type: "buy" } })).toBe(1);
  });
});

describe("the anchor for a position typed onto the holding", () => {
  it("refuses a by-value change when a later operation exists, for contributions and redemptions alike", async () => {
    const h = await holding({ opening: false, cost: 5000 });
    await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "dividend", totalAmount: 10, fees: 0, taxWithheld: 0, incomeType: "dividend", date: parseLocalDate("2026-12-01") },
    });
    await expect(contribute(h.id)).rejects.toMatchObject({ status: 422, code: "holding.replay_mismatch" });
    await expect(redeem(h.id)).rejects.toMatchObject({ status: 422, code: "holding.replay_mismatch" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(1);
  });

  it("anchors an amount-only position with a delta adjustment and reopens the empty holding as one unit", async () => {
    const h = await holding({ quantity: 0, cost: 500, price: null, opening: false });
    const result = await contribute(h.id, { amount: 1000 });
    expect(result).toMatchObject({ mode: "by_value", quantity: 1, totalInvested: 1500 });
    const { ops } = await expectReplayMatches(h.id);
    expect(ops.map((op) => [op.type, op.quantity, op.totalAmount, op.adjustmentMode])).toEqual([
      ["adjustment", null, 500, null],
      ["buy", 1, 1000, null],
    ]);
  });

  it("puts the cashflow operation after an anchor that is stamped later than the transaction clock", async () => {
    // The only stored operation was created in the future, so the anchor is pinned 1 ms after it and the new buy has to follow.
    const future = new Date("2031-01-01T00:00:00.000Z");
    const h = await holding({ cost: 5000, opening: future });
    await prisma.investmentHolding.update({ where: { id: h.id }, data: { totalInvested: 5200, currentPrice: 5200 } });

    const result = await contribute(h.id, { amount: 1000 });
    expect(result.totalInvested).toBeCloseTo(6200, 2);
    const { ops } = await expectReplayMatches(h.id);
    expect(ops.map((op) => op.type)).toEqual(["adjustment", "adjustment", "buy"]);
    const stamps = ops.map((op) => op.createdAt.getTime());
    expect(stamps[1]).toBe(future.getTime() + 1);
    expect(stamps[2]).toBe(future.getTime() + 2);
    expect(ops[2].id).toBe(result.operationId);
  });

  it("anchors a redemption the same way", async () => {
    const h = await holding({ cost: 5000, price: 8000, opening: false });
    const result = await redeem(h.id, { amount: 2000 });
    expect(result).toMatchObject({ mode: "by_value", quantity: 1 });
    const { ops } = await expectReplayMatches(h.id);
    expect(ops.map((op) => op.type)).toEqual(["adjustment", "sell"]);
    // 2000 of an 8000 position takes a quarter of the 5000 cost.
    expect(result.totalInvested).toBeCloseTo(3750, 2);
  });
});

describe("recordInvestmentRedemption input checks", () => {
  it("refuses an amount that is not positive, and a received amount for a same-currency payout", async () => {
    const h = await holding();
    await expect(redeem(h.id, { amount: 0 })).rejects.toMatchObject({ status: 422, code: "rebalance.invalid_amount" });
    await expect(redeem(h.id, { amount: -1 })).rejects.toMatchObject({ code: "rebalance.invalid_amount" });
    await expect(redeem(h.id, { toAmount: 400 })).rejects.toMatchObject({ status: 422, code: "transfer.same_currency" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id, type: "sell" } })).toBe(0);
  });

  it("refuses a payout the broker's cash cannot cover once the sale is booked, and rolls everything back", async () => {
    // Earlier buys with no funding left the broker at -2000: the 400 from this sale still leaves it short.
    const other = await stock({ name: "Vale", ticker: "VALE3", opening: false });
    await recordOperation(USER, { holdingId: other.id, type: "buy", quantity: 1, pricePerUnit: 2000, totalAmount: 2000, date: "2026-09-01" }, prisma);
    const h = await holding();
    const before = await prisma.ledgerEntry.count({ where: { userId: USER } });
    await expect(redeem(h.id)).rejects.toMatchObject({ status: 422, code: "brokerage.insufficient_cash" });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(before);
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id, type: "sell" } })).toBe(0);
  });
});

describe("by-units redemptions", () => {
  it("sells units at the current price, or at the quantity and price given, and pays the proceeds out", async () => {
    const h = await stock();
    const derived = await redeem(h.id, { amount: 100 });
    expect(derived).toMatchObject({ mode: "by_units", quantity: 6, amount: 100 });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: derived.operationId } })).toMatchObject({ type: "sell", quantity: 4, pricePerUnit: 25, totalAmount: 100 });

    const explicit = await redeem(h.id, { amount: 60, date: "2026-10-16", quantity: 2, price: 30 });
    expect(explicit.quantity).toBe(4);
    // 100 + 60 came back to the checking account.
    expect((await accountBalances(USER, prisma, [f.pfChecking])).get(f.pfChecking)).toBeCloseTo(160, 2);
    expect((await accountBalances(USER, prisma, [f.broker])).get(f.broker)).toBeCloseTo(0, 2);
    await expectReplayMatches(h.id);
  });

  it("refuses units it cannot derive, and sells at a cost of zero while the position is worth nothing", async () => {
    const unpriced = await stock({ price: null });
    await expect(redeem(unpriced.id, { amount: 100 })).rejects.toMatchObject({ status: 422, code: "holding.units_required" });

    const worthless = await stock({ ticker: "OIBR3", name: "Oi", price: 0 });
    const sold = await redeem(worthless.id, { amount: 10, quantity: 2, price: 5 });
    expect(sold).toMatchObject({ mode: "by_units", quantity: 8 });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: sold.operationId } })).toMatchObject({ quantity: 2, pricePerUnit: 5 });
  });
});

describe("by-value redemptions of amount-based holdings", () => {
  it("sells without quantity from a holding that never had units, taking the amount out of its cost", async () => {
    const h = await holding({ quantity: 0, cost: 1000, price: null, opening: false });
    await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "buy", totalAmount: 1000, fees: 0, date: parseLocalDate("2026-08-14") },
    });

    const result = await redeem(h.id, { amount: 400 });
    expect(result).toMatchObject({ mode: "by_value", totalInvested: 600 });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } })).toMatchObject({ type: "sell", quantity: null, pricePerUnit: null, totalAmount: 400 });
  });
});

describe("redemption into another currency", () => {
  it("credits the received amount to the cash account instead of converting at today's rate", async () => {
    const usdBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Avenue", currency: "USD" } });
    const h = await holding({ accountId: usdBroker.id, currency: "USD", cost: 1000, price: 1000 });
    const result = await redeem(h.id, { amount: 100, toAmount: 480 });
    expect(result).toMatchObject({ mode: "by_value", amount: 100 });
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: result.transferGroupId! }, orderBy: { amount: "asc" } });
    expect(legs.map((l) => [l.accountId, l.currency, toNumber(l.amount)])).toEqual([
      [usdBroker.id, "USD", -100],
      [f.pfChecking, "BRL", 480],
    ]);

    // Without it the amount converts at 1 USD = 5 BRL.
    const converted = await redeem(h.id, { amount: 100, date: "2026-10-16" });
    const convertedLegs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: converted.transferGroupId! }, orderBy: { amount: "asc" } });
    expect(convertedLegs.map((l) => toNumber(l.amount))).toEqual([-100, 500]);

    // A zero received amount is not an amount either.
    const zero = await redeem(h.id, { amount: 100, date: "2026-10-17", toAmount: 0 });
    const zeroLegs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: zero.transferGroupId! }, orderBy: { amount: "asc" } });
    expect(zeroLegs.map((l) => toNumber(l.amount))).toEqual([-100, 500]);
  });
});
