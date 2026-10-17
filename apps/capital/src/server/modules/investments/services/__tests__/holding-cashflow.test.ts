import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AssetClass } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { round } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { undoBatch, withMutationSource } from "@capital/server/modules/ledger/services/mutations";
import { updateTransactionTool } from "@capital/server/modules/mcp/tools/manage-transactions";
import { recalculateAllHoldings, replayPosition } from "@capital/server/modules/investments/lib/holding-position";
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
  ticker?: string | null;
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
      ticker: opts.ticker ?? null,
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
  it("defaults fixed income, savings, and a caixinha name to by_value", () => {
    expect(resolveCashflowMode({ assetClass: "fixed_income", name: "CDB" }, {})).toBe("by_value");
    expect(resolveCashflowMode({ assetClass: "savings", name: "Poupança" }, {})).toBe("by_value");
    expect(resolveCashflowMode({ assetClass: "stocks", name: "Caixinha Reserva" }, {})).toBe("by_value");
    expect(resolveCashflowMode({ assetClass: "stocks", name: "PETR4" }, {})).toBe("by_units");
    expect(resolveCashflowMode({ assetClass: "stocks", name: "PETR4" }, { mode: "by_value" })).toBe("by_value");
    expect(resolveCashflowMode({ assetClass: "fixed_income", name: "CDB" }, { mode: "by_units" })).toBe("by_units");
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
    expect(result.transferGroupIds).toHaveLength(2);
    const groups = await prisma.transferGroup.findMany({ where: { id: { in: result.transferGroupIds } } });
    const byId = new Map(groups.map((group) => [group.id, group.direction]));
    expect(result.transferGroupIds.map((id) => byId.get(id))).toEqual(["capital_injection", "investment_deposit"]);
    const again = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: LABEL },
      prisma,
    );
    expect(again).toMatchObject({ duplicate: true, operationId: result.operationId, transferGroupIds: result.transferGroupIds });
    const aportes = await contributions(USER, prisma, { months: 1, end: "2026-10", entityIds: [f.pjId] });
    expect(aportes.months[0].deposits).toBe(APORTE);
    expect(aportes.months[0].origins[0]).toMatchObject({ sourceEntityName: "PF", amount: APORTE });
    expect((await accountBalances(USER, prisma, [pjBroker])).get(pjBroker)).toBeCloseTo(0, 2);
    expect(result.quantity).toBe(1);
    expect(result.totalInvested).toBeCloseTo(COST + APORTE, 2);
    const deposit = groups.find((group) => group.direction === "investment_deposit")!;
    const hop = groups.find((group) => group.direction === "capital_injection")!;
    expect(deposit.description).toBe(LABEL);
    expect(hop.description).not.toBe(LABEL);
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: (await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } })).cashEntryId! },
    });
    expect(cash.description).toBe(LABEL);
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

  it("refuses implicit by_value on a quoted ticker, keeps notes, and rejects an archived broker", async () => {
    const quoted = await caixinha({ accountId: f.broker, assetClass: "stocks", name: "Caixinha PETR4", ticker: "PETR4" });
    await expect(
      recordInvestmentContribution(USER, { holdingId: quoted.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "holding.quoted_by_value" });
    const explicit = await recordInvestmentContribution(
      USER,
      { holdingId: quoted.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, mode: "by_value", notes: "lote" },
      prisma,
    );
    expect(explicit).toMatchObject({ mode: "by_value", quantity: 1 });
    const buy = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: explicit.operationId } });
    expect(buy.notes).toBe("lote\nby_value");

    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    const closed = await caixinha({ accountId: f.broker, name: "Caixinha arquivada" });
    await expect(
      recordInvestmentContribution(USER, { holdingId: closed.id, cashAccountId: f.pfChecking, amount: APORTE, date: "2026-10-16" }, prisma),
    ).rejects.toMatchObject({ status: 422, code: "account.archived" });
  });

  it("names the transfer and the buy verbatim, and falls back without a trailing space", async () => {
    const named = await caixinha({ accountId: f.broker });
    const verbatim = await recordInvestmentContribution(
      USER,
      {
        holdingId: named.id,
        cashAccountId: f.pfChecking,
        amount: APORTE,
        date: DAY,
        description: "Aplicação Caixinha",
        operationDescription: "Compra da caixinha",
      },
      prisma,
    );
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: verbatim.transferGroupId! } });
    const transferLegs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: group.id } });
    expect(group.description).toBe("Aplicação Caixinha");
    expect(transferLegs.every((leg) => leg.description === "Aplicação Caixinha" && leg.categoryId === null)).toBe(true);
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: (await prisma.investmentOperation.findUniqueOrThrow({ where: { id: verbatim.operationId } })).cashEntryId! },
    });
    expect(cash.description).toBe("Compra da caixinha");

    const blank = await caixinha({ accountId: f.broker, name: "Caixinha Nubank PJ", ticker: "" });
    const fallback = await recordInvestmentContribution(
      USER,
      { holdingId: blank.id, cashAccountId: f.pfChecking, amount: APORTE, date: "2026-10-16", description: "   " },
      prisma,
    );
    const fallbackCash = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: (await prisma.investmentOperation.findUniqueOrThrow({ where: { id: fallback.operationId } })).cashEntryId! },
    });
    expect(fallbackCash.description).toBe("Aporte Caixinha Nubank PJ");
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: fallback.transferGroupId! } })).description).toBe("Aporte Caixinha Nubank PJ");

    const quoted = await caixinha({ accountId: f.broker, name: "CDB Banco", ticker: "CDB24", assetClass: "fixed_income" });
    const byTicker = await recordInvestmentContribution(
      USER,
      { holdingId: quoted.id, cashAccountId: f.pfChecking, amount: 100, date: DAY },
      prisma,
    );
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: byTicker.transferGroupId! } })).description).toBe("Aporte CDB24");
  });

  it("puts an investment category on the buy only, and an edit keeps the operation link", async () => {
    const category = await prisma.category.create({ data: { userId: USER, name: "Caixinha", type: "investment" } });
    const expense = await prisma.category.create({ data: { userId: USER, name: "Mercado", type: "expense" } });
    const archived = await prisma.category.create({ data: { userId: USER, name: "Velha", type: "investment", isArchived: true } });
    const foreign = await prisma.category.create({ data: { userId: OTHER, name: "Outra", type: "investment" } });
    const holding = await caixinha({ accountId: f.broker });
    const input = { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY };
    await expect(recordInvestmentContribution(USER, { ...input, categoryId: expense.id }, prisma)).rejects.toMatchObject({ status: 422, code: "category.type_mismatch" });
    await expect(recordInvestmentContribution(USER, { ...input, categoryId: archived.id }, prisma)).rejects.toMatchObject({ status: 422, code: "category.archived" });
    await expect(recordInvestmentContribution(USER, { ...input, categoryId: foreign.id }, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await expect(recordInvestmentContribution(USER, { ...input, categoryId: "00000000-0000-4000-8000-000000000000" }, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id, type: "buy" } })).toBe(0);

    const result = await recordInvestmentContribution(USER, { ...input, description: "Aplicação Caixinha", categoryId: category.id }, prisma);
    const operation = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } });
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: operation.cashEntryId! } });
    expect(cash).toMatchObject({ description: "Aplicação Caixinha", categoryId: category.id, transferGroupId: null });
    expect(operation.fundingGroupId).toBe(result.transferGroupId);

    const edited = await updateTransactionTool(USER, { id: cash.id, description: "Aporte Caixinha Nubank PJ", category: "Caixinha" }, prisma);
    expect(edited).toMatchObject({ description: "Aporte Caixinha Nubank PJ", category: "Caixinha", transferGroupId: null });
    const afterEdit = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } });
    expect(afterEdit.cashEntryId).toBe(cash.id);
    expect(afterEdit.fundingGroupId).toBe(result.transferGroupId);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: cash.id } })).categoryId).toBe(category.id);

    const editBatch = await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER, undoneAt: null }, orderBy: { createdAt: "desc" } });
    await undoBatch(USER, editBatch.id, prisma);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: cash.id } })).toMatchObject({
      description: "Aplicação Caixinha",
      categoryId: category.id,
    });

    const transferLeg = await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: result.transferGroupId!, amount: { lt: 0 } } });
    await updateTransactionTool(USER, { id: transferLeg.id, description: "Novo aporte", category: "Caixinha" }, prisma);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: result.transferGroupId! } });
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: group.id } });
    expect(group.description).toBe("Novo aporte");
    expect(legs.every((leg) => leg.description === "Novo aporte" && leg.categoryId === null)).toBe(true);
    expect(afterEdit.fundingGroupId).toBe(group.id);

    const transferEdit = await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER, undoneAt: null }, orderBy: { createdAt: "desc" } });
    await undoBatch(USER, transferEdit.id, prisma);
    await undoBatch(USER, result.batchId!, prisma);
    expect(await prisma.ledgerEntry.findUnique({ where: { id: cash.id } })).toBeNull();
    expect(await prisma.transferGroup.findUnique({ where: { id: group.id } })).toBeNull();
  });

  it("undoes a by_value contribution back to the price, cost, quantity, and balances", async () => {
    const holding = await caixinha({ accountId: f.broker });
    const before = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    const balancesBefore = await accountBalances(USER, prisma, [f.broker, f.pfChecking]);
    const result = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: LABEL },
      prisma,
    );
    expect(result.currentPrice).toBeCloseTo(VALUE + APORTE, 2);
    await undoBatch(USER, result.batchId!, prisma);
    const after = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    expect(after.currentPrice).toBe(before.currentPrice);
    expect(after.totalInvested).toBe(before.totalInvested);
    expect(after.averageCost).toBe(before.averageCost);
    expect(after.currentQuantity).toBe(before.currentQuantity);
    const balances = await accountBalances(USER, prisma, [f.broker, f.pfChecking]);
    expect(balances.get(f.broker) ?? 0).toBe(balancesBefore.get(f.broker) ?? 0);
    expect(balances.get(f.pfChecking) ?? 0).toBe(balancesBefore.get(f.pfChecking) ?? 0);
    expect((await recalculateAllHoldings(prisma, { userId: USER })).changed).toEqual([]);
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

    const again = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: VALUE, date: DAY },
      prisma,
    );
    expect(again).toMatchObject({ duplicate: true, operationId: result.operationId, batchId: null });
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id, type: "sell" } })).toBe(1);
  });

  it("reopens a fully redeemed by_value holding as one unit worth the new cash", async () => {
    const holding = await caixinha({ accountId: f.broker });
    await recordInvestmentRedemption(USER, { holdingId: holding.id, cashAccountId: f.pfChecking, amount: VALUE, date: DAY }, prisma);
    const result = await recordInvestmentContribution(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: "2026-10-16", description: LABEL },
      prisma,
    );
    expect(result).toMatchObject({ duplicate: false, mode: "by_value", quantity: 1 });
    expect(result.totalInvested).toBeCloseTo(APORTE, 2);
    expect(result.averageCost).toBeCloseTo(APORTE, 2);
    expect(result.currentPrice).toBeCloseTo(APORTE, 2);
    const stored = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    expect(stored.isActive).toBe(true);
    const buy = (await replayMatches(holding.id)).ops.find((op) => op.type === "buy");
    expect(buy).toMatchObject({ quantity: 1, totalAmount: APORTE });
  });

  it("sends a PJ caixinha back to PF checking", async () => {
    const pjBroker = await broker(f.pjId, "Nubank PJ");
    const holding = await caixinha({ accountId: pjBroker });
    const result = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: "Resgate" },
      prisma,
    );
    expect(result.transferGroupIds).toHaveLength(2);
    const groups = await prisma.transferGroup.findMany({ where: { id: { in: result.transferGroupIds } } });
    const byId = new Map(groups.map((group) => [group.id, group.direction]));
    expect(result.transferGroupIds.map((id) => byId.get(id))).toEqual(["investment_withdrawal", "profit_distribution"]);
    const again = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: "Resgate" },
      prisma,
    );
    expect(again).toMatchObject({ duplicate: true, operationId: result.operationId, transferGroupIds: result.transferGroupIds });
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

  it("names a redemption from the ticker or the holding name", async () => {
    const named = await caixinha({ accountId: f.broker, ticker: "" });
    const result = await recordInvestmentRedemption(
      USER,
      { holdingId: named.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY },
      prisma,
    );
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: result.transferGroupId! } })).description).toBe("Resgate Caixinha Nubank PJ");
    const cash = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: (await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } })).cashEntryId! },
    });
    expect(cash.description).toBe("Resgate Caixinha Nubank PJ");

    const ticker = await caixinha({ accountId: f.broker, name: "CDB Banco", ticker: "CDB24" });
    const byTicker = await recordInvestmentRedemption(
      USER,
      { holdingId: ticker.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-10-16", operationDescription: "Saída da caixinha" },
      prisma,
    );
    expect((await prisma.transferGroup.findUniqueOrThrow({ where: { id: byTicker.transferGroupId! } })).description).toBe("Resgate CDB24");
    const tickerCash = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: (await prisma.investmentOperation.findUniqueOrThrow({ where: { id: byTicker.operationId } })).cashEntryId! },
    });
    expect(tickerCash.description).toBe("Saída da caixinha");
  });

  it("undoes a by_value redemption back to the price, cost, quantity, and balances", async () => {
    const holding = await caixinha({ accountId: f.broker });
    const before = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    const balancesBefore = await accountBalances(USER, prisma, [f.broker, f.pfChecking]);
    const result = await recordInvestmentRedemption(
      USER,
      { holdingId: holding.id, cashAccountId: f.pfChecking, amount: APORTE, date: DAY, description: "Resgate" },
      prisma,
    );
    expect(result.currentPrice).toBeCloseTo(VALUE - APORTE, 2);
    await undoBatch(USER, result.batchId!, prisma);
    const after = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    expect(after.currentPrice).toBe(before.currentPrice);
    expect(after.totalInvested).toBe(before.totalInvested);
    expect(after.averageCost).toBe(before.averageCost);
    expect(after.currentQuantity).toBe(before.currentQuantity);
    const balances = await accountBalances(USER, prisma, [f.broker, f.pfChecking]);
    expect(balances.get(f.broker) ?? 0).toBe(balancesBefore.get(f.broker) ?? 0);
    expect(balances.get(f.pfChecking) ?? 0).toBe(balancesBefore.get(f.pfChecking) ?? 0);
    expect((await recalculateAllHoldings(prisma, { userId: USER })).changed).toEqual([]);
  });
});
