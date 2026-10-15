import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AssetClass } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { round } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { withMutationSource } from "@capital/server/modules/ledger/services/mutations";
import { replayPosition } from "@capital/server/modules/investments/lib/holding-position";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { contributions } from "../contributions";
import { recordInvestmentContribution, recordInvestmentRedemption, resolveCashflowMode } from "../holding-cashflow";

const USER = "test-user-holding-cashflow-001";
const OTHER = "test-user-holding-cashflow-002";
const COST = 29883;
const VALUE = 39943.76;
const APORTE = 10000;
const DAY = "2026-10-15";
const LABEL = "Aplicação Caixinha Nubank PJ (CDB)";

let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

async function broker(entityId: string, name: string, currency = "BRL") {
  const account = await prisma.account.create({ data: { userId: USER, entityId, type: "brokerage", name, currency } });
  return account.id;
}

async function caixinha(opts: {
  accountId: string;
  name?: string;
  assetClass?: AssetClass;
  currency?: string;
  quantity?: number;
  cost?: number;
  price?: number | null;
  opening?: boolean;
}) {
  const quantity = opts.quantity ?? 1;
  const cost = opts.cost ?? COST;
  const price = opts.price === undefined ? VALUE : opts.price;
  const holding = await prisma.investmentHolding.create({
    data: {
      accountId: opts.accountId,
      name: opts.name ?? "Caixinha Nubank PJ",
      assetClass: opts.assetClass ?? "fixed_income",
      currency: opts.currency ?? "BRL",
      currentQuantity: quantity,
      averageCost: quantity > 0 ? cost / quantity : 0,
      totalInvested: cost,
      currentPrice: price,
    },
  });
  if (opts.opening !== false && quantity > 0) {
    await prisma.investmentOperation.create({
      data: {
        holdingId: holding.id,
        type: "adjustment",
        quantity,
        pricePerUnit: cost / quantity,
        totalAmount: cost,
        fees: 0,
        date: parseLocalDate("2026-08-14"),
        adjustmentMode: "absolute",
        notes: "opening",
      },
    });
  }
  return holding;
}

async function replayMatches(holdingId: string) {
  const [holding, ops] = await Promise.all([
    prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } }),
    prisma.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const replayed = replayPosition(ops);
  expect(replayed.quantity).toBeCloseTo(holding.currentQuantity, 6);
  expect(replayed.cost).toBeCloseTo(holding.totalInvested, 2);
  return { holding, replayed, ops };
}

describe("resolveCashflowMode", () => {
  const base = { assetClass: "stocks" as const, name: "PETR4", currentQuantity: 10 };

  it("defaults a caixinha and fixed income to by_value, and a one-unit position when units are omitted", () => {
    expect(resolveCashflowMode({ ...base, assetClass: "fixed_income", currentQuantity: 1 }, {})).toBe("by_value");
    expect(resolveCashflowMode({ ...base, assetClass: "savings", currentQuantity: 4 }, {})).toBe("by_value");
    expect(resolveCashflowMode({ ...base, name: "Caixinha Reserva" }, {})).toBe("by_value");
    expect(resolveCashflowMode({ ...base, currentQuantity: 1 }, {})).toBe("by_value");
    expect(resolveCashflowMode(base, {})).toBe("by_units");
    expect(resolveCashflowMode({ ...base, currentQuantity: 1 }, { quantity: 1 })).toBe("by_units");
    expect(resolveCashflowMode({ ...base, assetClass: "fixed_income" }, { mode: "by_units" })).toBe("by_units");
  });
});

describe("recordInvestmentContribution", () => {
  it("adds value to a qty-1 caixinha without new units, counts one aporte, and leaves broker cash at zero", async () => {
    const pjBroker = await broker(f.pjId, "Nubank PJ");
    const holding = await caixinha({ accountId: pjBroker });
    const result = await withMutationSource("mcp", () =>
      recordInvestmentContribution(USER, { holdingId: holding.id, cashAccountId: f.pjChecking, amount: APORTE, date: DAY, description: LABEL }, prisma),
    );

    expect(result).toMatchObject({ duplicate: false, mode: "by_value", quantity: 1, amount: APORTE });
    expect(result.totalInvested).toBeCloseTo(COST + APORTE, 2);
    expect(result.averageCost).toBeCloseTo(COST + APORTE, 2);
    expect(result.currentPrice).toBeCloseTo(VALUE + APORTE, 2);
    expect(result.currentPrice! - result.totalInvested).toBeCloseTo(VALUE - COST, 2);
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: result.batchId! } });
    expect(batch.source).toBe("mcp");

    const { ops } = await replayMatches(holding.id);
    const buy = ops.find((op) => op.type === "buy");
    expect(buy).toMatchObject({ quantity: 0, pricePerUnit: null, totalAmount: APORTE, notes: "by_value", fundingGroupId: result.transferGroupId });
    expect(ops.filter((op) => op.type === "adjustment")).toHaveLength(1);

    const balances = await accountBalances(USER, prisma, [pjBroker, f.pjChecking]);
    expect(balances.get(pjBroker)).toBeCloseTo(0, 2);
    expect(balances.get(f.pjChecking)).toBeCloseTo(-APORTE, 2);

    const aportes = await contributions(USER, prisma, { months: 1, end: "2026-10", entityIds: [f.pjId] });
    expect(aportes.months[0]).toMatchObject({ deposits: APORTE, withdrawals: 0 });
    expect(aportes.months[0].origins).toEqual([
      expect.objectContaining({ amount: APORTE, description: LABEL, direction: "investment_deposit" }),
    ]);

    const again = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pjChecking, amount: APORTE, date: DAY, description: LABEL },
      prisma,
    );
    expect(again).toMatchObject({ duplicate: true, operationId: result.operationId, batchId: null });
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id, type: "buy" } })).toBe(1);
    expect((await accountBalances(USER, prisma, [f.pjChecking])).get(f.pjChecking)).toBeCloseTo(-APORTE, 2);
  });

  it("books a PF aporte on the PF broker the same way", async () => {
    const holding = await caixinha({ accountId: f.broker, name: "Caixinha Nubank PF" });
    const result = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: LABEL },
      prisma,
    );
    expect(result).toMatchObject({ mode: "by_value", quantity: 1, totalInvested: COST + APORTE });
    expect(result.currentPrice).toBeCloseTo(VALUE + APORTE, 2);
    const groups = await prisma.transferGroup.findMany({ where: { id: { in: result.transferGroupIds } } });
    expect(groups.map((group) => group.direction)).toEqual(["investment_deposit"]);
    const aportes = await contributions(USER, prisma, { months: 1, end: "2026-10", entityIds: [f.pfId] });
    expect(aportes.months[0].deposits).toBe(APORTE);
    expect((await accountBalances(USER, prisma, [f.broker])).get(f.broker)).toBeCloseTo(0, 2);
    await replayMatches(holding.id);
  });

  it("hops a PF checking account into a PJ broker and still counts one aporte", async () => {
    const pjBroker = await broker(f.pjId, "Nubank PJ");
    const holding = await caixinha({ accountId: pjBroker });
    const result = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: LABEL },
      prisma,
    );
    const groups = await prisma.transferGroup.findMany({ where: { id: { in: result.transferGroupIds } } });
    expect(groups.map((group) => group.direction).sort()).toEqual(["capital_injection", "investment_deposit"]);
    const aportes = await contributions(USER, prisma, { months: 1, end: "2026-10", entityIds: [f.pjId] });
    expect(aportes.months[0].deposits).toBe(APORTE);
    expect(aportes.months[0].origins[0]).toMatchObject({ sourceEntityName: "PF", amount: APORTE });
    expect((await accountBalances(USER, prisma, [pjBroker])).get(pjBroker)).toBeCloseTo(0, 2);
    expect(result.quantity).toBe(1);
    expect(result.totalInvested).toBeCloseTo(COST + APORTE, 2);
  });

  it("converts a BRL deposit into a USD caixinha at the amount given", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 5 } });
    const usdBroker = await broker(f.pfId, "Avenue", "USD");
    const holding = await caixinha({ accountId: usdBroker, currency: "USD" });
    const result = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: 50000, toAmount: APORTE, date: DAY, description: LABEL },
      prisma,
    );
    expect(result).toMatchObject({ mode: "by_value", quantity: 1, amount: APORTE });
    expect(result.totalInvested).toBeCloseTo(COST + APORTE, 2);
    expect(result.currentPrice).toBeCloseTo(VALUE + APORTE, 2);
    const balances = await accountBalances(USER, prisma, [usdBroker, f.pfChecking]);
    expect(balances.get(usdBroker)).toBeCloseTo(0, 2);
    expect(balances.get(f.pfChecking)).toBeCloseTo(-50000, 2);
    await replayMatches(holding.id);
  });

  it("rejects quantity on a by-value contribution and a same-currency toAmount", async () => {
    const holding = await caixinha({ accountId: f.broker });
    await expect(
      recordInvestmentContribution(USER, { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, quantity: 1 }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "holding.value_mode" });
    await expect(
      recordInvestmentContribution(USER, { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, toAmount: APORTE }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "transfer.same_currency" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id, type: "buy" } })).toBe(0);
  });

  it("anchors a position that was typed on, so replay ends where the update does", async () => {
    const holding = await caixinha({ accountId: f.broker, opening: false });
    const result = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY },
      prisma,
    );
    expect(result).toMatchObject({ quantity: 1 });
    expect(result.totalInvested).toBeCloseTo(COST + APORTE, 2);
    expect(result.currentPrice).toBeCloseTo(VALUE + APORTE, 2);
    const { ops } = await replayMatches(holding.id);
    expect(ops.map((op) => op.type)).toEqual(["adjustment", "buy"]);
    expect(ops[0]).toMatchObject({ adjustmentMode: "absolute", quantity: 1, totalAmount: COST });
    expect(ops[1]).toMatchObject({ quantity: 0, totalAmount: APORTE });
  });

  it("buys units when mode is by_units, and a stock without a price cannot derive them", async () => {
    const holding = await caixinha({ accountId: f.broker, assetClass: "stocks", name: "PETR4", quantity: 10, cost: 200, price: 25 });
    const bought = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: 100, date: DAY, mode: "by_units", quantity: 2, price: 50 },
      prisma,
    );
    expect(bought).toMatchObject({ mode: "by_units", quantity: 12 });
    expect(bought.totalInvested).toBeCloseTo(300, 2);
    expect(bought.currentPrice).toBeCloseTo(25, 6);
    const bare = await caixinha({ accountId: f.broker, assetClass: "stocks", name: "VALE3", quantity: 10, cost: 200, price: null });
    await expect(
      recordInvestmentContribution(USER, { holdingId: bare.id, cashAccountId: f.pfChecking, amount: 100, date: DAY }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "holding.units_required" });
  });

  it("serializes a parallel double-submit into one aporte", async () => {
    const holding = await caixinha({ accountId: f.broker });
    const input = { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: LABEL };
    const [a, b] = await Promise.all([
      recordInvestmentContribution(USER, input, prisma),
      recordInvestmentContribution(USER, input, prisma),
    ]);
    expect([a, b].filter((row) => row.duplicate)).toHaveLength(1);
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id, type: "buy" } })).toBe(1);
    expect((await accountBalances(USER, prisma, [f.pfChecking])).get(f.pfChecking)).toBeCloseTo(-APORTE, 2);
  });

  it("hides another user's holding", async () => {
    const holding = await caixinha({ accountId: f.broker });
    await expect(
      recordInvestmentContribution(OTHER, { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY }, prisma),
    ).rejects.toMatchObject({ status: 404, code: "holding.not_found" });
  });
});

describe("recordInvestmentRedemption", () => {
  it("keeps quantity, removes cost in proportion to value, and returns the cash", async () => {
    const pjBroker = await broker(f.pjId, "Nubank PJ");
    const holding = await caixinha({ accountId: pjBroker });
    const costRemoved = round(COST * (APORTE / VALUE), 8);
    const result = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pjChecking, amount: APORTE, date: DAY, description: "Resgate Caixinha Nubank PJ" },
      prisma,
    );
    expect(result).toMatchObject({ duplicate: false, mode: "by_value", quantity: 1, amount: APORTE });
    expect(result.totalInvested).toBeCloseTo(COST - costRemoved, 2);
    expect(result.averageCost).toBeCloseTo(COST - costRemoved, 2);
    expect(result.currentPrice).toBeCloseTo(VALUE - APORTE, 2);
    const { replayed, ops } = await replayMatches(holding.id);
    expect(replayed.realizedGain).toBeCloseTo(APORTE - costRemoved, 2);
    const sell = ops.find((op) => op.type === "sell");
    expect(sell).toMatchObject({ quantity: 0, totalAmount: APORTE });
    expect(sell?.pricePerUnit).toBeCloseTo(costRemoved, 6);

    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: result.transferGroupId! } });
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((leg) => (leg.metadata as { operationId?: string } | null)?.operationId === result.operationId)).toBe(true);

    const balances = await accountBalances(USER, prisma, [pjBroker, f.pjChecking]);
    expect(balances.get(pjBroker)).toBeCloseTo(0, 2);
    expect(balances.get(f.pjChecking)).toBeCloseTo(APORTE, 2);
    const aportes = await contributions(USER, prisma, { months: 1, end: "2026-10", entityIds: [f.pjId] });
    expect(aportes.months[0]).toMatchObject({ deposits: 0, withdrawals: APORTE });

    const again = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pjChecking, amount: APORTE, date: DAY },
      prisma,
    );
    expect(again).toMatchObject({ duplicate: true, operationId: result.operationId, batchId: null });
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id, type: "sell" } })).toBe(1);
  });

  it("rejects a redemption above the current value and does not write", async () => {
    const holding = await caixinha({ accountId: f.broker });
    const before = await prisma.investmentOperation.count({ where: { holdingId: holding.id } });
    await expect(
      recordInvestmentRedemption(USER, { holdingId: holding.id, cashAccountId: f.pfChecking, amount: VALUE + 1, date: DAY }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "holding.above_value" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id } })).toBe(before);
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
  });

  it("zeros a caixinha paid out in full", async () => {
    const holding = await caixinha({ accountId: f.broker });
    const result = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: VALUE, date: DAY },
      prisma,
    );
    expect(result).toMatchObject({ quantity: 0, totalInvested: 0, averageCost: 0 });
    const stored = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    expect(stored.isActive).toBe(false);
    const { replayed } = await replayMatches(holding.id);
    expect(replayed.closed).toBe(true);
    expect((await accountBalances(USER, prisma, [f.broker])).get(f.broker)).toBeCloseTo(0, 2);
    expect((await accountBalances(USER, prisma, [f.pfChecking])).get(f.pfChecking)).toBeCloseTo(VALUE, 2);
  });

  it("sends a PJ caixinha back to PF checking", async () => {
    const pjBroker = await broker(f.pjId, "Nubank PJ");
    const holding = await caixinha({ accountId: pjBroker });
    const result = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: "Resgate" },
      prisma,
    );
    const groups = await prisma.transferGroup.findMany({ where: { id: { in: result.transferGroupIds } } });
    expect(groups.map((group) => group.direction).sort()).toEqual(["investment_withdrawal", "profit_distribution"]);
    const withdrawal = groups.find((group) => group.direction === "investment_withdrawal")!;
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: withdrawal.id } });
    expect(legs.every((leg) => (leg.metadata as { operationId?: string } | null)?.operationId === result.operationId)).toBe(true);
    const onward = groups.find((group) => group.direction === "profit_distribution")!;
    const onwardLegs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: onward.id } });
    expect(onwardLegs.every((leg) => (leg.metadata as { operationId?: string } | null)?.operationId == null)).toBe(true);
    expect((await accountBalances(USER, prisma, [pjBroker])).get(pjBroker)).toBeCloseTo(0, 2);
    expect(result.quantity).toBe(1);
  });

  it("pays a USD caixinha out in BRL", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 5 } });
    const usdBroker = await broker(f.pfId, "Avenue", "USD");
    const holding = await caixinha({ accountId: usdBroker, currency: "USD" });
    const result = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, toAmount: 52000, date: DAY },
      prisma,
    );
    expect(result.quantity).toBe(1);
    expect(result.currentPrice).toBeCloseTo(VALUE - APORTE, 2);
    const balances = await accountBalances(USER, prisma, [usdBroker, f.pfChecking]);
    expect(balances.get(usdBroker)).toBeCloseTo(0, 2);
    expect(balances.get(f.pfChecking)).toBeCloseTo(52000, 2);
    await replayMatches(holding.id);
  });

  it("hides another user's holding", async () => {
    const holding = await caixinha({ accountId: f.broker });
    await expect(
      recordInvestmentRedemption(OTHER, { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY }, prisma),
    ).rejects.toMatchObject({ status: 404, code: "holding.not_found" });
  });
});
