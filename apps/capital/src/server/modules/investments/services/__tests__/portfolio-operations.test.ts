import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { undoBatch, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { recalculateAllHoldings } from "../../lib/holding-position";
import {
  adjustPosition,
  cashImpact,
  countOperations,
  createHolding,
  deleteOperation,
  getOwnedHolding,
  incomeCreditAccount,
  incomeOperationType,
  isIncomeOperation,
  listHoldings,
  listOperations,
  OPERATION_INCLUDE,
  recordOperation,
  serializeHolding,
  serializeOperation,
  updateHolding,
  updateOperation,
} from "../portfolio";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";

const USER = "test-user-inv-pfops-001";
// Tickers that resolve to a global Asset row: a prefix the cleanup below can find.
const TICKER_PREFIX = "ZZPFO";
let f: LedgerFixture;

beforeEach(async () => {
  // 1 BRL = 0.2 USD, so 1 USD = 5 BRL.
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: TICKER_PREFIX } } });
});

const holdingRow = (id: string) => prisma.investmentHolding.findUniqueOrThrow({ where: { id } });
const legRow = (id: string) => prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });

async function stock(ticker = "PETR4", price = 40) {
  return createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker, name: "Petrobras", currentPrice: price }, prisma);
}

describe("pure helpers", () => {
  it("knows which operation types are income and which type an income type is recorded as", () => {
    expect(isIncomeOperation("dividend")).toBe(true);
    expect(isIncomeOperation("yield_payment")).toBe(true);
    expect(isIncomeOperation("buy")).toBe(false);
    expect(incomeOperationType("interest")).toBe("yield_payment");
    expect(incomeOperationType("fixed_income_interest")).toBe("yield_payment");
    expect(incomeOperationType("jcp")).toBe("dividend");
    expect(incomeOperationType("fii_income")).toBe("dividend");
    expect(incomeOperationType("dividend")).toBe("dividend");
  });

  it("signs the cash of every operation type: buys and deposits out, sales and withdrawals in, income net of tax, the rest none", () => {
    expect(cashImpact("buy", 1000, 10)).toBe(-1010);
    expect(cashImpact("deposit", 500, 0)).toBe(-500);
    expect(cashImpact("sell", 1000, 10)).toBe(990);
    expect(cashImpact("withdrawal", 500, 5)).toBe(495);
    expect(cashImpact("dividend", 100, 0, 15)).toBe(85);
    expect(cashImpact("yield_payment", 100, 0)).toBe(100);
    expect(cashImpact("split", 100, 0)).toBe(0);
    expect(cashImpact("adjustment", 100, 0)).toBe(0);
  });
});

describe("createHolding", () => {
  it("opens an undo batch of its own with record, labelled by the ticker, and undo removes the holding", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "vale3", name: "Vale", currentPrice: 60 }, prisma, { record: true });
    expect(h.ticker).toBe("VALE3");
    expect(h.batchId).not.toBeNull();
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: h.batchId! }, include: { records: true } });
    expect(batch).toMatchObject({ op: "create", summary: "VALE3" });
    expect(batch.records.map((r) => [r.model, r.recordId])).toEqual([["InvestmentHolding", h.id]]);

    await undoBatch(USER, h.batchId!, prisma);
    expect(await prisma.investmentHolding.count({ where: { id: h.id } })).toBe(0);
  });

  it("labels the batch by the name when the holding has no ticker", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", subType: "cdb", name: "CDB Banco X" }, prisma, { record: true });
    expect(h.batchId).not.toBeNull();
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: h.batchId! } })).summary).toBe("CDB Banco X");
    expect(await holdingRow(h.id)).toMatchObject({ ticker: null, subType: "cdb", currentPrice: null, lastPriceUpdate: null });
  });

  it("joins the caller's batch with collect, writing no batch of its own", async () => {
    const records: MutationRecordInput[] = [];
    const before = await prisma.mutationBatch.count({ where: { userId: USER } });
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "HGLG11", name: "CSHG", currency: "USD" }, prisma, { collect: records, record: true });
    expect(h.batchId).toBeNull();
    expect(h.currency).toBe("USD");
    expect(records).toEqual([expect.objectContaining({ model: "InvestmentHolding", recordId: h.id, before: null })]);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(before);
  });

  it("drops the sub-type of anything but fixed income, and refuses an account that is not a brokerage", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", subType: "cdb", ticker: "WEGE3", name: "WEG" }, prisma);
    expect(h.subType).toBeNull();
    await expect(createHolding(USER, { accountId: f.pfChecking, assetClass: "stocks", ticker: "WEGE3", name: "WEG" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "holding.requires_brokerage",
    });
  });
});

describe("getOwnedHolding and listHoldings", () => {
  it("refuses a holding of someone else or one that does not exist", async () => {
    await expect(getOwnedHolding(USER, "no-such-holding", prisma)).rejects.toMatchObject({ status: 404, code: "holding.not_found" });
    const h = await stock();
    await expect(getOwnedHolding("another-user", h.id, prisma)).rejects.toMatchObject({ status: 404, code: "holding.not_found" });
    expect((await getOwnedHolding(USER, h.id, prisma)).account.id).toBe(f.broker);
  });

  it("filters by account, exact ticker, a name or ticker fragment and archived brokers", async () => {
    const other = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Rico", currency: "BRL" } });
    const petr = await stock("PETR4");
    const vale = await createHolding(USER, { accountId: other.id, assetClass: "stocks", ticker: "VALE3", name: "Vale SA" }, prisma);
    const names = async (opts: Parameters<typeof listHoldings>[2]) => (await listHoldings(USER, prisma, opts)).map((h) => h.ticker).sort();

    expect(await names({})).toEqual(["PETR4", "VALE3"]);
    expect(await names({ accountId: other.id })).toEqual(["VALE3"]);
    expect(await names({ ticker: " petr4 " })).toEqual(["PETR4"]);
    expect(await names({ ticker: "petr" })).toEqual([]);
    expect(await names({ query: "vale" })).toEqual(["VALE3"]);
    expect(await names({ query: "petro" })).toEqual(["PETR4"]);

    await prisma.account.update({ where: { id: other.id }, data: { archivedAt: new Date() } });
    expect(await names({})).toEqual(["PETR4", "VALE3"]);
    expect(await names({ includeArchivedAccounts: false })).toEqual(["PETR4"]);
    expect(petr.id).not.toBe(vale.id);
  });
});

describe("serializeHolding", () => {
  it("has no gain percent for a holding with no cost, and converts a foreign holding at today's rate", async () => {
    const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const voo = await createHolding(USER, { accountId: ibkr.id, assetClass: "international_etf", ticker: "VOO", name: "Vanguard", currentPrice: 500 }, prisma);
    await recordOperation(USER, { holdingId: voo.id, type: "buy", quantity: 2, pricePerUnit: 400, totalAmount: 800, date: "2026-09-01" }, prisma);
    const fx = await loadFx(USER, prisma);
    const [row] = await listHoldings(USER, prisma);
    expect(serializeHolding(row, fx)).toMatchObject({
      currency: "USD",
      marketValue: 1000,
      unrealizedGain: 200,
      unrealizedGainPercent: 0.25,
      fxRate: 5,
      marketValueBase: 5000,
      investedBase: 4000,
      unrealizedGainBase: 1000,
      priceStatus: expect.any(String),
    });

    const empty = await stock("WEGE3", 10);
    const rows = await listHoldings(USER, prisma, { ticker: "WEGE3" });
    expect(rows[0].id).toBe(empty.id);
    expect(serializeHolding(rows[0], fx)).toMatchObject({ totalInvested: 0, unrealizedGainPercent: null, lastPriceUpdate: expect.any(String) });
  });
});

describe("updateHolding", () => {
  it("refuses a holding that is not the user's", async () => {
    await expect(updateHolding(USER, "no-such-holding", { name: "x" }, prisma)).rejects.toMatchObject({ status: 404, code: "holding.not_found" });
  });

  it("applies each field of the patch, stamps the price with the given day, and records an undo batch labelled by the ticker", async () => {
    const h = await stock("PETR4", 40);
    const patched = await updateHolding(
      USER,
      h.id,
      { name: "Petrobras PN", currency: "BRL", allocationClass: "cash", subType: null, currentPrice: 41.5, priceAsOf: "2026-11-09", isActive: false },
      prisma,
    );
    expect(patched.batchId).not.toBeNull();
    expect(await holdingRow(h.id)).toMatchObject({
      name: "Petrobras PN",
      allocationClass: "cash",
      currentPrice: 41.5,
      lastPriceUpdate: new Date("2026-11-09T12:00:00.000Z"),
      isActive: false,
    });
    expect(await prisma.mutationBatch.findUniqueOrThrow({ where: { id: patched.batchId! } })).toMatchObject({ op: "update", summary: "PETR4" });

    await undoBatch(USER, patched.batchId!, prisma);
    expect(await holdingRow(h.id)).toMatchObject({ name: "Petrobras", allocationClass: null, currentPrice: 40, isActive: true });
  });

  it("stamps a price change with now when no day is given, and leaves the stamp alone when the price is not in the patch", async () => {
    const h = await stock("PETR4", 40);
    const stamped = (await holdingRow(h.id)).lastPriceUpdate!;
    await updateHolding(USER, h.id, { name: "Petrobras ON" }, prisma, { record: false });
    expect((await holdingRow(h.id)).lastPriceUpdate).toEqual(stamped);

    const before = Date.now();
    await updateHolding(USER, h.id, { currentPrice: 42 }, prisma, { record: false });
    const after = await holdingRow(h.id);
    expect(after.currentPrice).toBe(42);
    expect(after.lastPriceUpdate!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("upper-cases a new ticker and clears it with null; a holding with no ticker is labelled by its name", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", name: "Caixinha Nubank" }, prisma);
    const named = await updateHolding(USER, h.id, { name: "Caixinha Inter" }, prisma);
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: named.batchId! } })).summary).toBe("Caixinha Inter");

    const withTicker = await updateHolding(USER, h.id, { ticker: "abcd11" }, prisma, { record: false });
    expect(withTicker.ticker).toBe("ABCD11");
    const cleared = await updateHolding(USER, h.id, { ticker: null }, prisma, { record: false });
    expect(cleared.ticker).toBeNull();
    const blank = await updateHolding(USER, h.id, { ticker: "" }, prisma, { record: false });
    expect(blank.ticker).toBeNull();
  });

  it("writes no batch with record false, and joins the caller's records with collect", async () => {
    const h = await stock("PETR4", 40);
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    const quiet = await updateHolding(USER, h.id, { name: "A" }, prisma, { record: false });
    expect(quiet.batchId).toBeNull();

    const records: MutationRecordInput[] = [];
    const collected = await updateHolding(USER, h.id, { name: "B" }, prisma, { collect: records });
    expect(collected.batchId).toBeNull();
    expect(records).toEqual([expect.objectContaining({ model: "InvestmentHolding", recordId: h.id, before: expect.objectContaining({ name: "A" }), after: expect.objectContaining({ name: "B" }) })]);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
  });

  it("links the holding to a global asset when its ticker becomes a priceable one, and drops the link when it stops matching", async () => {
    const ticker = `${TICKER_PREFIX}1`;
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", name: "Sem ticker" }, prisma);
    expect(await holdingRow(h.id)).toMatchObject({ assetId: null, priceSource: "manual" });

    const linked = await updateHolding(USER, h.id, { ticker }, prisma, { record: false });
    expect(linked.assetId).not.toBeNull();
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: linked.assetId! } });
    expect(asset).toMatchObject({ symbol: ticker, market: "B3", currency: "BRL" });
    expect((await holdingRow(h.id)).priceSource).toBe("auto");

    // Same identity again: nothing to relink.
    const same = await updateHolding(USER, h.id, { name: "Renomeado" }, prisma, { record: false });
    expect(same.assetId).toBe(linked.assetId);

    // A currency the market does not quote in: the link is dropped and the price goes back to manual.
    const unlinked = await updateHolding(USER, h.id, { currency: "USD" }, prisma, { record: false });
    expect(unlinked).toMatchObject({ assetId: null, priceSource: "manual" });
  });

  it("keeps a holding that still resolves to nothing unlinked", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", name: "CDB" }, prisma);
    const changed = await updateHolding(USER, h.id, { assetClass: "savings" }, prisma, { record: false });
    expect(changed).toMatchObject({ assetClass: "savings", assetId: null, priceSource: "manual" });
  });
});

describe("incomeCreditAccount", () => {
  it("accepts a checking account and refuses an archived one, naming it", async () => {
    expect((await incomeCreditAccount(USER, f.pfChecking, prisma)).id).toBe(f.pfChecking);
    const archived = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Antiga", currency: "BRL", archivedAt: new Date() } });
    await expect(incomeCreditAccount(USER, archived.id, prisma)).rejects.toMatchObject({ status: 422, code: "account.archived", params: { name: "Antiga" } });
  });
});

describe("recordOperation", () => {
  it("labels a cash leg with the given description, trimmed, instead of the generated one", async () => {
    const h = await stock();
    const booked = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-01", description: "  Compra manual  " }, prisma);
    expect((await legRow(booked.cashEntryId!)).description).toBe("Compra manual");
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: booked.batchId! } })).summary).toBe("Compra manual");
  });

  it("books no cash leg for a split, which moves no cash", async () => {
    const h = await stock();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01" }, prisma);
    const split = await recordOperation(USER, { holdingId: h.id, type: "split", quantity: 10, totalAmount: 0, date: "2026-09-02" }, prisma);
    expect(split.cashEntryId).toBeNull();
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 20, totalInvested: 400 });
  });

  it("joins the caller's batch with collect, and writes none with record false", async () => {
    const h = await stock();
    const records: MutationRecordInput[] = [];
    const joined = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-01" }, prisma, { collect: records });
    expect(joined.batchId).toBeNull();
    expect(records.map((r) => r.model).sort()).toEqual(["InvestmentOperation", "LedgerEntry"]);

    const quiet = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-02" }, prisma, { record: false });
    expect(quiet.batchId).toBeNull();
  });

  it("stores the dividend origin only on a plain dividend, and the externalId and notes it is given", async () => {
    const h = await stock();
    const dividend = await recordOperation(
      USER,
      { holdingId: h.id, type: "dividend", incomeType: "dividend", dividendOrigin: "BR", totalAmount: 10, date: "2026-09-01", externalId: "ext-1", notes: "setembro" },
      prisma,
    );
    expect(dividend.operation).toMatchObject({ incomeType: "dividend", dividendOrigin: "BR", externalId: "ext-1", notes: "setembro" });
    const jcp = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "jcp", dividendOrigin: "BR", totalAmount: 10, date: "2026-09-02" }, prisma);
    expect(jcp.operation.dividendOrigin).toBeNull();
  });

  it("keeps the cash credit amount and rate it is given for an income credited to another account", async () => {
    const h = await stock();
    const booked = await recordOperation(
      USER,
      { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 20, date: "2026-09-01", creditToAccountId: f.pfChecking, cashCredit: { amount: 99.5, exchangeRate: 1.1 } },
      prisma,
    );
    const leg = await legRow(booked.cashEntryId!);
    expect(toNumber(leg.amount)).toBe(99.5);
    expect(toNumber(leg.exchangeRate)).toBe(1.1);
    expect(toNumber(leg.amountBase)).toBeCloseTo(109.45, 4);
  });
});

describe("updateOperation", () => {
  it("refuses an operation of someone else or one that does not exist", async () => {
    await expect(updateOperation(USER, "no-such-operation", { notes: "x" }, prisma)).rejects.toMatchObject({ status: 404, code: "operation.not_found" });
  });

  it("changes the income type, relabelling the leg, and keeps writing the externalId, notes and quantity it is given", async () => {
    const h = await stock();
    const div = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 50, date: "2026-09-01" }, prisma);
    const patched = await updateOperation(USER, div.operation.id, { incomeType: "jcp", externalId: "ext-9", notes: "jcp", quantity: 3, pricePerUnit: 2 }, prisma);
    expect(patched.operation).toMatchObject({ incomeType: "jcp", externalId: "ext-9", notes: "jcp", quantity: 3, pricePerUnit: 2, syncLocked: true });
    expect((await legRow(div.cashEntryId!)).description).toBe("JCP PETR4");

    const cleared = await updateOperation(USER, div.operation.id, { incomeType: null }, prisma);
    expect(cleared.operation.incomeType).toBeNull();
  });

  it("moves an income's cash to another account, converting to its currency, and back when the credit account is cleared", async () => {
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Conta USD", currency: "USD" } });
    const h = await stock();
    const div = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 100, date: "2026-09-01" }, prisma);
    expect((await legRow(div.cashEntryId!)).accountId).toBe(f.broker);

    await updateOperation(USER, div.operation.id, { creditToAccountId: usd.id }, prisma);
    const toUsd = await legRow(div.cashEntryId!);
    // R$ 100 at 1 USD = 5 BRL.
    expect(toUsd).toMatchObject({ accountId: usd.id, entityId: f.pfId, currency: "USD" });
    expect(toNumber(toUsd.amount)).toBe(20);
    expect(toNumber(toUsd.exchangeRate)).toBe(5);
    expect(toNumber(toUsd.amountBase)).toBe(100);

    // Editing the amount keeps the credit on the account it is on, without naming it again.
    await updateOperation(USER, div.operation.id, { totalAmount: 200 }, prisma);
    expect(toNumber((await legRow(div.cashEntryId!)).amount)).toBe(40);
    expect((await legRow(div.cashEntryId!)).accountId).toBe(usd.id);

    await updateOperation(USER, div.operation.id, { creditToAccountId: null }, prisma);
    const back = await legRow(div.cashEntryId!);
    expect(back).toMatchObject({ accountId: f.broker, currency: "BRL" });
    expect(toNumber(back.amount)).toBe(200);
  });

  it("fills the category of an income leg that has none, but never replaces one it has", async () => {
    const h = await stock();
    const div = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 50, date: "2026-09-01" }, prisma);
    expect((await legRow(div.cashEntryId!)).categoryId).not.toBeNull();

    await prisma.ledgerEntry.update({ where: { id: div.cashEntryId! }, data: { categoryId: null } });
    await updateOperation(USER, div.operation.id, { notes: "again" }, prisma);
    const filled = (await legRow(div.cashEntryId!)).categoryId;
    expect(filled).not.toBeNull();
    expect((await prisma.category.findUniqueOrThrow({ where: { id: filled! } })).type).toBe("income");

    const mine = await prisma.category.create({ data: { userId: USER, name: "Meus proventos", type: "income" } });
    await prisma.ledgerEntry.update({ where: { id: div.cashEntryId! }, data: { categoryId: mine.id } });
    await updateOperation(USER, div.operation.id, { totalAmount: 60 }, prisma);
    expect((await legRow(div.cashEntryId!)).categoryId).toBe(mine.id);
  });

  it("trashes the leg when the edit makes the operation stop moving cash, and quietly ignores a leg that is already in the trash", async () => {
    const h = await stock();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01" }, prisma);
    const second = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-02" }, prisma);
    await updateOperation(USER, second.operation.id, { type: "split", totalAmount: 0 }, prisma);
    expect((await legRow(second.cashEntryId!)).deletedAt).not.toBeNull();
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: second.operation.id } })).cashEntryId).toBeNull();

    // A leg someone already trashed by hand: the edit finds nothing to trash and unlinks it.
    const third = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-03" }, prisma);
    await prisma.ledgerEntry.update({ where: { id: third.cashEntryId! }, data: { deletedAt: new Date() } });
    const records: MutationRecordInput[] = [];
    await updateOperation(USER, third.operation.id, { type: "split", totalAmount: 0 }, prisma, { collect: records });
    expect(records.map((r) => r.model)).toEqual(["InvestmentOperation"]);
  });

  it("gives an operation recorded without a leg one when an edit starts moving cash, and leaves one that still moves none without", async () => {
    const h = await stock();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01" }, prisma);
    const split = await recordOperation(USER, { holdingId: h.id, type: "split", quantity: 10, totalAmount: 0, date: "2026-09-02" }, prisma);
    expect(split.cashEntryId).toBeNull();

    const still = await updateOperation(USER, split.operation.id, { quantity: 5 }, prisma);
    expect(still.operation.cashEntryId).toBeNull();

    const sale = await updateOperation(USER, split.operation.id, { type: "sell", quantity: 5, totalAmount: 250 }, prisma, { record: false });
    expect(sale.batchId).toBeNull();
    const leg = await legRow(sale.operation.cashEntryId!);
    expect(toNumber(leg.amount)).toBe(250);
    expect(leg).toMatchObject({ accountId: f.broker, categoryId: null, description: "Venda PETR4" });
  });

  it("gives a dividend recorded without a leg a categorized one", async () => {
    const h = await stock();
    const div = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 0, date: "2026-09-01" }, prisma);
    expect(div.cashEntryId).toBeNull();
    const patched = await updateOperation(USER, div.operation.id, { totalAmount: 30 }, prisma);
    const leg = await legRow(patched.operation.cashEntryId!);
    expect(toNumber(leg.amount)).toBe(30);
    expect(leg.categoryId).not.toBeNull();
  });

  it("joins the caller's batch with collect", async () => {
    const h = await stock();
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-01" }, prisma);
    const records: MutationRecordInput[] = [];
    const patched = await updateOperation(USER, buy.operation.id, { totalAmount: 41 }, prisma, { collect: records });
    expect(patched.batchId).toBeNull();
    expect(records.map((r) => r.model).sort()).toEqual(["InvestmentOperation", "LedgerEntry"]);
  });

  it("unlinks income that convertIncomeToDividend adopted instead of rewriting it", async () => {
    const h = await stock();
    const income = await adoptedIncome(h.id, 75, { holdingId: h.id, investmentOperationId: "op", origin: "import", nested: { a: 1 } });
    await updateOperation(USER, income.operationId, { totalAmount: 80, notes: "edited" }, prisma);
    const leg = await legRow(income.entryId);
    expect(toNumber(leg.amount)).toBe(75);
    expect(leg.deletedAt).toBeNull();
    // The link keys are gone, every other key stays.
    expect(leg.metadata).toEqual({ origin: "import", nested: { a: 1 } });
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: income.operationId } })).cashEntryId).toBeNull();
  });
});

/** An income row adopted as the cash of a dividend, as convertIncomeToDividend leaves it. */
async function adoptedIncome(holdingId: string, amount: number, metadata: Prisma.InputJsonValue | typeof Prisma.DbNull) {
  const category = await prisma.category.create({ data: { userId: USER, name: `Proventos ${Math.random()}`, type: "income" } });
  const entry = await prisma.ledgerEntry.create({
    data: {
      userId: USER,
      entityId: f.pfId,
      accountId: f.pfChecking,
      kind: "income",
      amount,
      currency: "BRL",
      exchangeRate: 1,
      amountBase: amount,
      date: new Date("2026-09-01T12:00:00Z"),
      effectiveDate: new Date("2026-09-01T12:00:00Z"),
      description: "Dividendo adotado",
      categoryId: category.id,
      metadata,
    },
  });
  const op = await prisma.investmentOperation.create({
    data: { holdingId, type: "dividend", incomeType: "dividend", totalAmount: amount, fees: 0, taxWithheld: 0, date: new Date("2026-09-01T12:00:00Z"), cashEntryId: entry.id },
  });
  return { entryId: entry.id, operationId: op.id };
}

describe("deleteOperation", () => {
  it("refuses an operation that does not exist", async () => {
    await expect(deleteOperation(USER, "no-such-operation", prisma)).rejects.toMatchObject({ status: 404, code: "operation.not_found" });
  });

  it("releases adopted income with whatever metadata it had instead of trashing it", async () => {
    const h = await stock();
    const cases: [string, Prisma.InputJsonValue | typeof Prisma.DbNull, unknown][] = [
      ["no metadata", Prisma.DbNull, null],
      ["a list", ["list"], null],
      ["a string", "text", null],
      ["only the link keys", { holdingId: h.id, investmentOperationId: "op" }, null],
      ["link keys and others", { holdingId: h.id, kept: true }, { kept: true }],
    ];
    for (const [label, metadata, expected] of cases) {
      const income = await adoptedIncome(h.id, 10, metadata);
      const deleted = await deleteOperation(USER, income.operationId, prisma);
      expect(deleted.cashEntryId, label).toBe(income.entryId);
      const leg = await legRow(income.entryId);
      expect(leg.deletedAt, label).toBeNull();
      expect(leg.metadata, label).toEqual(expected);
    }
  });

  it("skips the oversell check inside a caller's batch, and the funding when none was asked for", async () => {
    const h = await stock();
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01", fundFromAccountId: f.pfChecking }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 8, pricePerUnit: 40, totalAmount: 320, date: "2026-09-02" }, prisma);
    const records: MutationRecordInput[] = [];
    // A standalone delete would be refused (the sale depends on this buy); inside an import revert it goes through.
    const deleted = await deleteOperation(USER, buy.operation.id, prisma, { collect: records });
    expect(deleted).toMatchObject({ deleted: buy.operation.id, batchId: null, fundingGroupId: null });
    expect(await prisma.transferGroup.count({ where: { id: buy.fundingGroupId! } })).toBe(1);
    expect(records.map((r) => r.model)).toEqual(["InvestmentOperation", "LedgerEntry"]);
  });

  it("writes no batch with record false", async () => {
    const h = await stock();
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-01" }, prisma);
    const deleted = await deleteOperation(USER, buy.operation.id, prisma, { record: false });
    expect(deleted.batchId).toBeNull();
    expect(await prisma.investmentOperation.count({ where: { id: buy.operation.id } })).toBe(0);
  });

  it("leaves the funding transfer when the buy's cash did not sit on the broker or no leg survives", async () => {
    const h = await stock();
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-01", fundFromAccountId: f.pfChecking }, prisma);
    // The broker's leg of the funding transfer was already trashed by hand.
    await prisma.ledgerEntry.updateMany({ where: { transferGroupId: buy.fundingGroupId!, accountId: f.broker }, data: { deletedAt: new Date() } });
    const deleted = await deleteOperation(USER, buy.operation.id, prisma, { withFunding: true });
    expect(deleted.fundingGroupId).toBeNull();
  });
});

describe("listOperations and countOperations", () => {
  it("filters by holding, account and date range, and pages with limit and offset", async () => {
    const other = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Rico", currency: "BRL" } });
    const petr = await stock("PETR4");
    const vale = await createHolding(USER, { accountId: other.id, assetClass: "stocks", ticker: "VALE3", name: "Vale" }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-08-01" }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 1, pricePerUnit: 41, totalAmount: 41, date: "2026-08-15" }, prisma);
    await recordOperation(USER, { holdingId: vale.id, type: "buy", quantity: 1, pricePerUnit: 60, totalAmount: 60, date: "2026-08-20" }, prisma);

    const tickers = (ops: Awaited<ReturnType<typeof listOperations>>) => ops.map((o) => o.holding.ticker);
    expect(tickers(await listOperations(USER, prisma, { holdingId: vale.id }))).toEqual(["VALE3"]);
    expect(tickers(await listOperations(USER, prisma, { accountId: other.id }))).toEqual(["VALE3"]);
    expect(tickers(await listOperations(USER, prisma, { from: new Date("2026-08-10T00:00:00Z") }))).toEqual(["VALE3", "PETR4"]);
    expect(tickers(await listOperations(USER, prisma, { to: new Date("2026-08-16T00:00:00Z") }))).toEqual(["PETR4", "PETR4"]);
    expect(tickers(await listOperations(USER, prisma, { from: new Date("2026-08-10T00:00:00Z"), to: new Date("2026-08-16T00:00:00Z") }))).toEqual(["PETR4"]);
    expect(tickers(await listOperations(USER, prisma, { limit: 1 }))).toEqual(["VALE3"]);
    expect(tickers(await listOperations(USER, prisma, { limit: 1, offset: 2 }))).toEqual(["PETR4"]);

    expect(await countOperations(USER, prisma)).toBe(3);
    expect(await countOperations(USER, prisma, { holdingId: petr.id })).toBe(2);
    expect(await countOperations(USER, prisma, { entityIds: [f.pjId] })).toBe(0);
  });
});

describe("serializeOperation", () => {
  it("serializes a bare operation row without its holding or cash leg", async () => {
    const h = await stock();
    const income = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 100, taxWithheld: 15, date: "2026-09-01" }, prisma);
    const bare = serializeOperation(income.operation);
    expect(bare).toMatchObject({
      holdingId: h.id,
      ticker: null,
      name: null,
      assetClass: null,
      allocationClass: null,
      accountId: null,
      accountName: null,
      entityId: null,
      currency: null,
      entityKind: null,
      amountBase: null,
      grossBase: null,
      taxBase: null,
      creditToAccountId: null,
      cashAmount: 85,
      date: "2026-09-01",
    });
  });

  it("derives the gross and tax in base currency from the leg, and ignores a leg that is in the trash", async () => {
    const h = await stock();
    const income = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 100, taxWithheld: 15, date: "2026-09-01", creditToAccountId: f.pfChecking }, prisma);
    const load = () => prisma.investmentOperation.findUniqueOrThrow({ where: { id: income.operation.id }, include: OPERATION_INCLUDE });
    expect(serializeOperation(await load())).toMatchObject({ amountBase: 85, grossBase: 100, taxBase: 15, creditToAccountId: f.pfChecking, entityKind: "personal", accountName: "XP", allocationClass: "br_stocks" });

    await prisma.ledgerEntry.update({ where: { id: income.cashEntryId! }, data: { deletedAt: new Date() } });
    expect(serializeOperation(await load())).toMatchObject({ amountBase: null, grossBase: null, taxBase: null, creditToAccountId: null });
  });

  it("books no leg for a fully taxed income, and gives a buy no base amounts", async () => {
    const h = await stock();
    const full = await recordOperation(USER, { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 50, taxWithheld: 50, date: "2026-09-01" }, prisma);
    // Zero net: no leg is booked at all.
    expect(full.cashEntryId).toBeNull();
    const load = (id: string) => prisma.investmentOperation.findUniqueOrThrow({ where: { id }, include: OPERATION_INCLUDE });
    expect(serializeOperation(await load(full.operation.id))).toMatchObject({ amountBase: null, cashAmount: 0 });

    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-02" }, prisma);
    expect(serializeOperation(await load(buy.operation.id))).toMatchObject({ amountBase: null, grossBase: null, taxBase: null, cashAmount: -40 });
  });
});

describe("adjustPosition", () => {
  it("sets the position to the broker's numbers with a default note, and undo brings the old one back", async () => {
    const h = await stock();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01" }, prisma);
    const adjusted = await adjustPosition(USER, { holdingId: h.id, currentQuantity: 8, averageCost: 42 }, prisma);
    expect(adjusted).toMatchObject({ currentQuantity: 8, averageCost: 42, totalInvested: 336 });
    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: h.id, type: "adjustment" } });
    expect(op).toMatchObject({ notes: "Manual adjustment", adjustmentMode: "absolute", quantity: 8, pricePerUnit: 42, totalAmount: 336 });

    await undoBatch(USER, adjusted.batchId, prisma);
    expect(await holdingRow(h.id)).toMatchObject({ currentQuantity: 10, totalInvested: 400 });
  });

  it("keeps the note it is given, and an adjustment to zero closes the position", async () => {
    const h = await stock();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01" }, prisma);
    const closed = await adjustPosition(USER, { holdingId: h.id, currentQuantity: 0, averageCost: 0, notes: "Vendi tudo na corretora" }, prisma);
    expect(closed).toMatchObject({ currentQuantity: 0, isActive: false });
    expect((await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: h.id, type: "adjustment" } })).notes).toBe("Vendi tudo na corretora");
    await expect(adjustPosition(USER, { holdingId: "no-such-holding", currentQuantity: 1, averageCost: 1 }, prisma)).rejects.toMatchObject({ code: "holding.not_found" });
  });
});

describe("recalculateAllHoldings across users", () => {
  it("scans every user's holdings when none is named, labelling one with no ticker by its name, and writes nothing in a dry run", async () => {
    const caixinha = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", name: "Caixinha Teste" }, prisma);
    await recordOperation(USER, { holdingId: caixinha.id, type: "buy", totalAmount: 1000, date: "2026-09-01" }, prisma);
    // What an older rule left behind: the stored cost is not what the operations replay to.
    await prisma.investmentHolding.update({ where: { id: caixinha.id }, data: { totalInvested: 900 } });

    const dry = await recalculateAllHoldings(prisma, { dryRun: true });
    expect(dry.checked).toBeGreaterThanOrEqual(1);
    const mine = dry.changed.find((c) => c.id === caixinha.id);
    expect(mine).toMatchObject({ userId: USER, label: "Caixinha Teste", before: { totalInvested: 900 }, after: { totalInvested: 1000 } });
    expect((await holdingRow(caixinha.id)).totalInvested).toBe(900);

    const scoped = await recalculateAllHoldings(prisma, { userId: USER });
    expect(scoped.changed.map((c) => c.id)).toEqual([caixinha.id]);
    expect((await holdingRow(caixinha.id)).totalInvested).toBe(1000);
  });
});
