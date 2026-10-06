import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { recalculateAllHoldings } from "../../lib/holding-position";
import {
  createHolding,
  deleteOperation,
  listHoldings,
  listOperations,
  OPERATION_INCLUDE,
  portfolioSummary,
  rebalanceSuggestion,
  recordOperation,
  serializeHolding,
  serializeOperation,
  setTargets,
  settleRounding,
  updateOperation,
} from "../portfolio";

const USER = "test-user-investments-portfolio-001";
let f: LedgerFixture;

beforeEach(async () => {
  // 1 BRL = 0.2 USD, so 1 USD = 5 BRL.
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const holdingRow = (id: string) => prisma.investmentHolding.findUniqueOrThrow({ where: { id } });
const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId) ?? 0;
const today = () => new Date().toISOString().slice(0, 10);

async function petr4(price = 40) {
  return createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: price }, prisma);
}

describe("cost basis", () => {
  it("includes fees, takes the sold share out on a partial sale and closes the position on a full one", async () => {
    const h = await petr4();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 100, pricePerUnit: 30, totalAmount: 3000, fees: 10, date: "2026-08-10", fundFromAccountId: f.pfChecking }, prisma);
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 100, averageCost: 30.1, totalInvested: 3010, isActive: true });

    await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 40, pricePerUnit: 35, totalAmount: 1400, fees: 4, date: "2026-08-20" }, prisma);
    const partial = await holdingRow(h.id);
    expect(partial.currentQuantity).toBe(60);
    expect(partial.averageCost).toBeCloseTo(30.1, 8);
    expect(partial.totalInvested).toBeCloseTo(1806, 8);
    const fx = await loadFx(USER, prisma);
    const [listed] = await listHoldings(USER, prisma);
    // 60 x 40 = 2400 against a cost of 1806.
    expect(serializeHolding(listed, fx)).toMatchObject({ marketValue: 2400, unrealizedGain: 594, marketValueBase: 2400, investedBase: 1806, unrealizedGainBase: 594, fxRate: 1 });

    const last = await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 60, pricePerUnit: 41, totalAmount: 2460, date: "2026-08-25" }, prisma);
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 0, averageCost: 0, totalInvested: 0, isActive: false });
    expect(await listHoldings(USER, prisma)).toEqual([]);
    const [closed] = await listHoldings(USER, prisma, { includeInactive: true });
    // A sold-out position is worth nothing, even with a price.
    expect(serializeHolding(closed, fx)).toMatchObject({ marketValue: 0, unrealizedGain: 0 });
    const summary = await portfolioSummary(USER, prisma);
    expect(summary).toMatchObject({ marketValue: 0, invested: 0, holdingsCount: 0 });

    // Undoing the last sale brings the position back, active again.
    await undoBatch(USER, last.batchId!, prisma);
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 60, isActive: true });
  });

  it("refuses a sale above the position and writes nothing", async () => {
    const h = await petr4();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-08-10" }, prisma);
    const entries = await prisma.ledgerEntry.count({ where: { userId: USER } });
    await expect(recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 11, pricePerUnit: 30, totalAmount: 330, date: "2026-08-11" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "holding.oversell",
    });
    // A back-dated sale before the buy oversells too.
    await expect(recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 1, pricePerUnit: 30, totalAmount: 30, date: "2026-08-01" }, prisma)).rejects.toMatchObject({
      code: "holding.oversell",
    });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entries);
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 10, isActive: true });
  });

  it("refuses an edit that makes a later sale exceed the position", async () => {
    const h = await petr4();
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-08-10" }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 8, pricePerUnit: 30, totalAmount: 240, date: "2026-08-11" }, prisma);
    await expect(updateOperation(USER, buy.operation.id, { quantity: 5, totalAmount: 150 }, prisma)).rejects.toMatchObject({ status: 422, code: "holding.oversell" });
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 2 });
  });

  it("keeps a statement import's sale even when the history does not cover it", async () => {
    const h = await petr4();
    const imp = await prisma.import.create({ data: { userId: USER, transactionCount: 1, fileName: "nota.pdf" } });
    const sale = await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 5, pricePerUnit: 30, totalAmount: 150, date: "2026-08-11", importId: imp.id }, prisma);
    expect(sale.operation.id).toBeTruthy();
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 0 });
  });
});

describe("funding", () => {
  it("debits the source in its own currency and credits the broker exactly what the buy costs", async () => {
    const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const voo = await createHolding(USER, { accountId: ibkr.id, assetClass: "international_etf", ticker: "VOO", name: "Vanguard S&P 500", currentPrice: 500 }, prisma);
    expect(voo.currency).toBe("USD");
    const buy = await recordOperation(USER, { holdingId: voo.id, type: "buy", quantity: 2, pricePerUnit: 500, totalAmount: 1000, fees: 1, date: "2026-09-01", fundFromAccountId: f.pfChecking }, prisma);
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: buy.fundingGroupId! }, orderBy: { amount: "asc" } });
    expect(legs.map((l) => [l.accountId, l.currency, toNumber(l.amount)])).toEqual([
      [f.pfChecking, "BRL", -5005],
      [ibkr.id, "USD", 1001],
    ]);
    expect(await balance(ibkr.id)).toBeCloseTo(0, 4);
    expect(await balance(f.pfChecking)).toBeCloseTo(-5005, 4);

    // fundAmount: the bank's real debit wins over today's rate.
    const second = await recordOperation(
      USER,
      { holdingId: voo.id, type: "buy", quantity: 1, pricePerUnit: 500, totalAmount: 500, date: "2026-09-02", fundFromAccountId: f.pfChecking, fundAmount: 2600 },
      prisma
    );
    const debit = await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: second.fundingGroupId!, accountId: f.pfChecking } });
    expect(toNumber(debit.amount)).toBe(-2600);
    expect(await balance(ibkr.id)).toBeCloseTo(0, 4);
  });

  it("undo removes the operation, its cash leg and its funding transfer together", async () => {
    const h = await petr4();
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-09-01", fundFromAccountId: f.pfChecking }, prisma);
    await undoBatch(USER, buy.batchId!, prisma);
    expect(await prisma.investmentOperation.count({ where: { id: buy.operation.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { id: buy.cashEntryId! } })).toBe(0);
    expect(await prisma.transferGroup.count({ where: { id: buy.fundingGroupId! } })).toBe(0);
    expect(await balance(f.pfChecking)).toBe(0);
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 0, totalInvested: 0 });
  });
});

describe("income", () => {
  it("credits the net amount to a bank account as an entry, and can move it back to the broker", async () => {
    const h = await petr4();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 100, pricePerUnit: 30, totalAmount: 3000, date: "2026-08-10", fundFromAccountId: f.pfChecking }, prisma);
    const jcp = await recordOperation(
      USER,
      { holdingId: h.id, type: "dividend", incomeType: "jcp", totalAmount: 100, taxWithheld: 15, date: today(), creditToAccountId: f.pfChecking },
      prisma
    );
    expect(jcp.batchId).not.toBeNull();
    const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: jcp.cashEntryId! } });
    expect(leg).toMatchObject({ accountId: f.pfChecking, entityId: f.pfId, kind: "investment", description: "JCP PETR4" });
    expect(toNumber(leg.amount)).toBe(85);
    expect(await balance(f.broker)).toBe(0);

    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: jcp.operation.id }, include: OPERATION_INCLUDE });
    expect(serializeOperation(op)).toMatchObject({
      type: "dividend",
      incomeType: "jcp",
      totalAmount: 100,
      taxWithheld: 15,
      cashAmount: 85,
      creditToAccountId: f.pfChecking,
      accountId: f.broker,
      accountName: "XP",
      entityId: f.pfId,
      currency: "BRL",
    });
    expect((await portfolioSummary(USER, prisma)).income12m).toBe(85);

    const moved = await updateOperation(USER, jcp.operation.id, { creditToAccountId: null, taxWithheld: 0 }, prisma);
    const back = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: jcp.cashEntryId! } });
    expect(back).toMatchObject({ accountId: f.broker });
    expect(toNumber(back.amount)).toBe(100);

    await undoBatch(USER, moved.batchId!, prisma);
    const restored = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: jcp.cashEntryId! } });
    expect(restored.accountId).toBe(f.pfChecking);
    expect(toNumber(restored.amount)).toBe(85);

    const del = await deleteOperation(USER, jcp.operation.id, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: jcp.cashEntryId! } })).deletedAt).not.toBeNull();
    expect(del.batchId).not.toBeNull();
  });

  it("keeps income fields on income and the tax under the gross amount", async () => {
    const h = await petr4();
    await expect(recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 30, totalAmount: 30, taxWithheld: 1, date: "2026-08-10" }, prisma)).rejects.toMatchObject({
      code: "operation.income_only",
    });
    await expect(recordOperation(USER, { holdingId: h.id, type: "dividend", totalAmount: 10, taxWithheld: 11, date: "2026-08-10" }, prisma)).rejects.toMatchObject({
      code: "operation.tax_exceeds_amount",
    });
    await expect(recordOperation(USER, { holdingId: h.id, type: "dividend", totalAmount: 10, date: "2026-08-10", creditToAccountId: f.card }, prisma)).rejects.toMatchObject({
      code: "operation.credit_account_invalid",
    });
  });
});

describe("summary and rebalance", () => {
  it("lists the six classes with broker cash as Caixa and every targeted class, and rebalances over them", async () => {
    const h = await petr4(50);
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 100, pricePerUnit: 50, totalAmount: 5000, date: "2026-08-10", fundFromAccountId: f.pfChecking }, prisma);
    // 5000 in BR stocks plus 5000 of broker cash.
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 5000, date: "2026-08-11" }, prisma);
    await setTargets(USER, [{ allocationClass: "br_stocks", targetPercent: 50 }, { allocationClass: "crypto", targetPercent: 30 }, { allocationClass: "cash", targetPercent: 20 }], prisma);

    const summary = await portfolioSummary(USER, prisma);
    expect(summary.allocation.map((a) => [a.allocationClass, a.marketValue, a.share, a.target])).toEqual([
      ["br_stocks", 5000, 0.5, 0.5],
      ["crypto", 0, 0, 0.3],
      ["cash", 5000, 0.5, 0.2],
    ]);
    expect(summary.netWorth).toBe(10000);

    // 20000 more makes 30000: 15000 BR stocks, 9000 crypto, 6000 cash; only cash is already over.
    const byClass = await rebalanceSuggestion(USER, 20000, "class", prisma);
    expect(byClass.total).toBe(10000);
    expect(byClass.classes.map((c) => [c.allocationClass, c.amount, c.afterShare])).toEqual([
      ["br_stocks", 10000, 0.5],
      ["crypto", 9000, 0.3],
      ["cash", 1000, 0.2],
    ]);
    // Less money than the classes need is split in proportion to the need.
    const small = await rebalanceSuggestion(USER, 5000, "class", prisma);
    expect(small.classes.map((c) => c.amount)).toEqual([1785.71, 3214.29, 0]);

    const byAsset = await rebalanceSuggestion(USER, 20000, "asset", prisma);
    expect(byAsset.assets).toEqual([
      expect.objectContaining({ kind: "holding", holdingId: h.id, ticker: "PETR4", accountId: f.broker, accountName: "XP", amount: 10000, approxQuantity: 200 }),
      expect.objectContaining({ kind: "new", holdingId: null, allocationClass: "crypto", amount: 9000 }),
      expect.objectContaining({ kind: "cash", holdingId: null, allocationClass: "cash", amount: 1000 }),
    ]);
  });

  it("never goes negative, adds up to the amount to the cent, lists held classes without a target, and follows the scope", async () => {
    // PF: 9000 in BR stocks (no target) and 1000 in fixed income. PJ: 3000 in FIIs on its own broker.
    const stocks = await petr4(1);
    await recordOperation(USER, { holdingId: stocks.id, type: "buy", quantity: 9000, pricePerUnit: 1, totalAmount: 9000, date: "2026-08-01", fundFromAccountId: f.pfChecking }, prisma);
    const cdb = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", name: "CDB" }, prisma);
    await recordOperation(USER, { holdingId: cdb.id, type: "buy", totalAmount: 1000, date: "2026-08-01", fundFromAccountId: f.pfChecking }, prisma);
    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } });
    const fii = await createHolding(USER, { accountId: pjBroker.id, assetClass: "fii", ticker: "HGLG11", name: "CSHG", currentPrice: 1 }, prisma);
    await recordOperation(USER, { holdingId: fii.id, type: "buy", quantity: 3000, pricePerUnit: 1, totalAmount: 3000, date: "2026-08-01", fundFromAccountId: f.pjChecking }, prisma);
    await setTargets(USER, [{ allocationClass: "fixed_income", targetPercent: 33.33 }, { allocationClass: "fii", targetPercent: 33.33 }, { allocationClass: "crypto", targetPercent: 33.34 }], prisma);

    const all = await rebalanceSuggestion(USER, 1000.01, "class", prisma);
    expect(all.total).toBe(13000);
    expect(all.classes.map((c) => c.allocationClass)).toEqual(["fixed_income", "br_stocks", "fii", "crypto"]);
    expect(all.classes.every((c) => c.amount >= 0)).toBe(true);
    expect(all.classes.find((c) => c.allocationClass === "br_stocks")!.amount).toBe(0);
    expect(Math.round(all.classes.reduce((s, c) => s + c.amount, 0) * 100)).toBe(100001);

    const assets = await rebalanceSuggestion(USER, 1000.01, "asset", prisma);
    expect(Math.round(assets.assets!.reduce((s, a) => s + a.amount, 0) * 100)).toBe(100001);
    expect(assets.assets!.every((a) => a.amount > 0)).toBe(true);
    expect(assets.assets!.find((a) => a.holdingId === fii.id)).toMatchObject({ accountId: pjBroker.id, accountName: "BTG", entityId: f.pjId, currency: "BRL" });

    // PF only: the PJ FIIs are out, so FIIs is an empty targeted class (a new asset).
    const pf = await rebalanceSuggestion(USER, 500, "asset", prisma, { entityIds: [f.pfId] });
    expect(pf.total).toBe(10000);
    expect(pf.assets!.some((a) => a.holdingId === fii.id)).toBe(false);
    expect(pf.assets!.find((a) => a.allocationClass === "fii")).toMatchObject({ kind: "new", holdingId: null });
    expect(pf.assets!.reduce((s, a) => s + a.amount, 0)).toBeCloseTo(500, 2);
  });

  it("settles rounding on the largest part", () => {
    expect(settleRounding([333.333, 333.333, 333.334], 1000)).toEqual([333.33, 333.33, 333.34]);
    expect(settleRounding([0.004, 0.004, 0.004], 0.01)).toEqual([0.01, 0, 0]);
    expect(settleRounding([-5, 10], 10)).toEqual([0, 10]);
    expect(settleRounding([], 0)).toEqual([]);
  });
});

describe("listOperations", () => {
  it("filters by scope and type and pages newest first", async () => {
    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } });
    const pf = await petr4();
    const pj = await createHolding(USER, { accountId: pjBroker.id, assetClass: "stocks", ticker: "WEGE3", name: "WEG" }, prisma);
    await recordOperation(USER, { holdingId: pf.id, type: "buy", quantity: 1, pricePerUnit: 30, totalAmount: 30, date: "2026-08-01" }, prisma);
    await recordOperation(USER, { holdingId: pf.id, type: "dividend", totalAmount: 2, date: "2026-08-15" }, prisma);
    await recordOperation(USER, { holdingId: pj.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-08-20" }, prisma);

    const ticker = (ops: Awaited<ReturnType<typeof listOperations>>) => ops.map((o) => `${o.holding.ticker}:${o.type}`);
    expect(ticker(await listOperations(USER, prisma))).toEqual(["WEGE3:buy", "PETR4:dividend", "PETR4:buy"]);
    expect(ticker(await listOperations(USER, prisma, { entityIds: [f.pjId] }))).toEqual(["WEGE3:buy"]);
    expect(ticker(await listOperations(USER, prisma, { types: ["dividend", "yield_payment"] }))).toEqual(["PETR4:dividend"]);
    expect(ticker(await listOperations(USER, prisma, { limit: 1, offset: 1 }))).toEqual(["PETR4:dividend"]);
  });
});

describe("recalculateAllHoldings", () => {
  it("fixes holdings stored by the old cost rules, skips ones without operations, and is idempotent", async () => {
    const sold = await petr4();
    await recordOperation(USER, { holdingId: sold.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, fees: 2, date: "2026-08-10" }, prisma);
    await recordOperation(USER, { holdingId: sold.id, type: "sell", quantity: 10, pricePerUnit: 31, totalAmount: 310, date: "2026-08-12" }, prisma);
    const partial = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "VALE3", name: "Vale" }, prisma);
    await recordOperation(USER, { holdingId: partial.id, type: "buy", quantity: 10, pricePerUnit: 50, totalAmount: 500, fees: 5, date: "2026-08-10" }, prisma);
    await recordOperation(USER, { holdingId: partial.id, type: "sell", quantity: 5, pricePerUnit: 55, totalAmount: 275, date: "2026-08-12" }, prisma);
    const direct = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "HGLG11", name: "CSHG Logística" }, prisma);
    // What the old logic left behind: a sold-out holding still active, a cost basis without fees or the sold share taken out,
    // and a position entered without operations.
    await prisma.investmentHolding.update({ where: { id: sold.id }, data: { isActive: true } });
    await prisma.investmentHolding.update({ where: { id: partial.id }, data: { totalInvested: 500 } });
    await prisma.investmentHolding.update({ where: { id: direct.id }, data: { currentQuantity: 3, totalInvested: 480, averageCost: 160 } });

    const dry = await recalculateAllHoldings(prisma, { userId: USER, dryRun: true });
    expect(dry).toMatchObject({ checked: 3, skipped: 1 });
    expect(dry.changed.map((c) => [c.label, c.before.isActive, c.after.isActive, c.after.totalInvested])).toEqual([
      ["PETR4", true, false, 0],
      ["VALE3", true, true, 252.5],
    ]);
    expect(await holdingRow(sold.id)).toMatchObject({ isActive: true });

    const run = await recalculateAllHoldings(prisma, { userId: USER });
    expect(run.changed).toHaveLength(2);
    expect(await holdingRow(sold.id)).toMatchObject({ isActive: false, currentQuantity: 0, totalInvested: 0 });
    expect(await holdingRow(partial.id)).toMatchObject({ isActive: true, currentQuantity: 5, totalInvested: 252.5, averageCost: 50.5 });
    expect(await holdingRow(direct.id)).toMatchObject({ isActive: true, currentQuantity: 3, totalInvested: 480 });

    expect((await recalculateAllHoldings(prisma, { userId: USER })).changed).toEqual([]);
  });
});
