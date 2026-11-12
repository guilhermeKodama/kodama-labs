import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Account, Prisma } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { createHolding } from "../portfolio";
import { convertIncomeToDividend, recordDividend, updateDividend } from "../dividends";

const USER = "test-user-inv-divedge-001";
let f: LedgerFixture;
let usdChecking: Account;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
  usdChecking = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Conta USD", currency: "USD" } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const at = (day: string) => new Date(`${day}T12:00:00Z`);

async function petr4() {
  return createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
}

async function vuaa() {
  const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
  return createHolding(USER, { accountId: ibkr.id, assetClass: "international_etf", ticker: "VUAA", name: "VUAA", currency: "USD" }, prisma);
}

/** A plain income row in the account, as a bank import leaves it. */
function incomeRow(patch: { accountId?: string; amount?: number; currency?: string; description?: string; kind?: "income" | "expense"; metadata?: Prisma.InputJsonValue; day?: string } = {}) {
  const amount = patch.amount ?? 40;
  const date = at(patch.day ?? "2026-08-05");
  return prisma.ledgerEntry.create({
    data: {
      userId: USER,
      entityId: f.pfId,
      accountId: patch.accountId ?? f.pfChecking,
      kind: patch.kind ?? "income",
      amount,
      currency: patch.currency ?? "BRL",
      exchangeRate: 1,
      amountBase: amount,
      date,
      effectiveDate: date,
      description: patch.description ?? "PETR4",
      metadata: patch.metadata,
    },
  });
}

describe("recordDividend refusals", () => {
  it("refuses an amount that is not positive, and a withholding that is negative or above the gross", async () => {
    const h = await petr4();
    const base = { holdingId: h.id, cashAccountId: f.pfChecking, date: "2026-08-05", currency: "BRL", incomeType: "dividend" as const };
    for (const amount of [0, -5, Number.NaN]) {
      await expect(recordDividend(USER, { ...base, amount }, prisma)).rejects.toMatchObject({ status: 422, code: "rebalance.invalid_amount" });
    }
    for (const withholdingTax of [-1, 100.01]) {
      await expect(recordDividend(USER, { ...base, amount: 100, withholdingTax }, prisma)).rejects.toMatchObject({ status: 422, code: "operation.tax_exceeds_amount" });
    }
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);
  });

  it("refuses a currency that is neither the holding's nor the cash account's, and accepts either one in any case", async () => {
    const h = await petr4();
    const base = { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", incomeType: "dividend" as const };
    await expect(recordDividend(USER, { ...base, currency: "EUR" }, prisma)).rejects.toMatchObject({ status: 422, code: "dividend.currency" });
    const lower = await recordDividend(USER, { ...base, currency: "brl" }, prisma);
    expect(lower.currency).toBe("BRL");
  });

  it("names the cash leg with the description it is given, trimmed, instead of the generated one", async () => {
    const h = await petr4();
    const result = await recordDividend(USER, { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "dividend", description: "  Dividendo extra  " }, prisma);
    expect(result.description).toBe("Dividendo extra");
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.cashEntryId! } })).description).toBe("Dividendo extra");
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: result.batchId! } })).summary).toBe("Dividendo extra");
  });

  it("stores the rate of the day on a leg credited in a foreign currency, converting a BRL dividend into it", async () => {
    const h = await petr4();
    const result = await recordDividend(USER, { holdingId: h.id, cashAccountId: usdChecking.id, amount: 100, date: "2026-08-12", currency: "BRL", incomeType: "dividend" }, prisma);
    const fx = await loadFx(USER, prisma);
    const rate = fx.rateOn("USD", at("2026-08-12"));
    const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.cashEntryId! } });
    expect(leg).toMatchObject({ accountId: usdChecking.id, currency: "USD" });
    expect(toNumber(leg.exchangeRate)).toBeCloseTo(rate, 6);
    expect(toNumber(leg.amount)).toBeCloseTo(round(100 / rate, 4), 3);
    expect(result.amountBase).toBeCloseTo(100, 2);
    expect(result.cashAccountId).toBe(usdChecking.id);
  });
});

describe("convertIncomeToDividend refusals and shapes", () => {
  it("refuses a negative withholding, an entry that does not exist or was deleted, and one that is not income", async () => {
    const h = await petr4();
    const row = await incomeRow();
    await expect(convertIncomeToDividend(USER, { transactionId: row.id, holdingId: h.id, incomeType: "dividend", withholdingTax: -1 }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "operation.tax_exceeds_amount",
    });
    await expect(convertIncomeToDividend(USER, { transactionId: "no-such-entry", holdingId: h.id, incomeType: "dividend" }, prisma)).rejects.toMatchObject({
      status: 404,
      code: "entry.not_found",
    });
    const trashed = await incomeRow({ description: "PETR4 lixo" });
    await prisma.ledgerEntry.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
    await expect(convertIncomeToDividend(USER, { transactionId: trashed.id, holdingId: h.id, incomeType: "dividend" }, prisma)).rejects.toMatchObject({ code: "entry.not_found" });

    const expense = await incomeRow({ kind: "expense", description: "PETR4 despesa" });
    await expect(convertIncomeToDividend(USER, { transactionId: expense.id, holdingId: h.id, incomeType: "dividend" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "dividend.not_income",
    });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);
  });

  it("refuses an income of zero", async () => {
    const h = await petr4();
    const zero = await incomeRow({ amount: 0 });
    await expect(convertIncomeToDividend(USER, { transactionId: zero.id, holdingId: h.id, incomeType: "dividend" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "rebalance.invalid_amount",
    });
  });

  it("names the batch after the generated description when the income row has none", async () => {
    const h = await petr4();
    const row = await incomeRow({ description: "" });
    const result = await convertIncomeToDividend(USER, { transactionId: row.id, holdingId: h.id, incomeType: "jcp" }, prisma);
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: result.batchId! } })).summary).toBe("JCP PETR4");
    expect(result.incomeType).toBe("jcp");
  });

  it("converts a foreign income and its withholding at the rate of its date", async () => {
    const h = await petr4();
    const row = await incomeRow({ accountId: usdChecking.id, currency: "USD", amount: 8, day: "2026-08-12" });
    const result = await convertIncomeToDividend(USER, { transactionId: row.id, holdingId: h.id, incomeType: "dividend", withholdingTax: 2 }, prisma);
    const fx = await loadFx(USER, prisma);
    const rate = fx.rateOn("USD", at("2026-08-12"));
    expect(result).toMatchObject({ currency: "USD", gross: 10, withholdingTax: 2, net: 8 });
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } });
    // The holding is in BRL: gross US$ 10 and tax US$ 2 at the rate of the day.
    expect(op.totalAmount).toBeCloseTo(round(10 * rate, 4), 3);
    expect(op.taxWithheld).toBeCloseTo(round(2 * rate, 4), 3);
  });

  it("reports an operation already linked to the entry as a duplicate, taking the income type from the request when it has none", async () => {
    const h = await petr4();
    const row = await incomeRow();
    const linked = await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "dividend", totalAmount: 40, taxWithheld: 0, date: at("2026-08-05"), cashEntryId: row.id },
    });
    const result = await convertIncomeToDividend(USER, { transactionId: row.id, holdingId: h.id, incomeType: "jcp" }, prisma);
    expect(result).toMatchObject({ duplicate: true, operationId: linked.id, incomeType: "jcp", batchId: null });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(1);
  });

  it("keeps the other metadata of an object, and drops metadata that is not an object, when it links the entry", async () => {
    const h = await petr4();
    const cases: [string, Prisma.InputJsonValue | undefined, Record<string, unknown>][] = [
      ["no metadata", undefined, {}],
      ["a list", ["x"], {}],
      ["a string", "text", {}],
      ["an object", { source: "pluggy", ref: 7 }, { source: "pluggy", ref: 7 }],
    ];
    for (const [label, metadata, kept] of cases) {
      const row = await incomeRow({ metadata, description: `PETR4 ${label}`, day: "2026-08-06" });
      const result = await convertIncomeToDividend(USER, { transactionId: row.id, holdingId: h.id, incomeType: "dividend" }, prisma);
      const stored = (await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } })).metadata;
      expect(stored, label).toEqual({ ...kept, holdingId: h.id, investmentOperationId: result.operationId });
      // Free the amount for the next case.
      await prisma.investmentOperation.delete({ where: { id: result.operationId } });
      await prisma.ledgerEntry.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    }
  });

  it("attaches the cash to a legacy dividend whose net is zero by comparing the gross, and keeps the other metadata", async () => {
    const h = await petr4();
    // Gross 40 with 40 withheld: nothing was net, so only the gross can match.
    const legacy = await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 40, taxWithheld: 40, date: at("2026-08-05") },
    });
    const row = await incomeRow({ amount: 10, metadata: { source: "pluggy" } });
    const attached = await convertIncomeToDividend(USER, { transactionId: row.id, holdingId: h.id, incomeType: "dividend", withholdingTax: 30 }, prisma);
    expect(attached).toMatchObject({ duplicate: false, operationId: legacy.id, gross: 40, withholdingTax: 30 });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ cashEntryId: row.id, totalAmount: 40, taxWithheld: 30 });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } })).metadata).toEqual({ source: "pluggy", holdingId: h.id, investmentOperationId: legacy.id });
  });

  it("drops metadata that is not an object when it attaches a legacy dividend", async () => {
    const h = await petr4();
    const legacy = await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "dividend", incomeType: "dividend", totalAmount: 40, taxWithheld: 0, date: at("2026-08-05") },
    });
    const row = await incomeRow({ metadata: ["x"] });
    await convertIncomeToDividend(USER, { transactionId: row.id, holdingId: h.id, incomeType: "dividend" }, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } })).metadata).toEqual({ holdingId: h.id, investmentOperationId: legacy.id });
  });
});

describe("updateDividend", () => {
  async function recorded(incomeType: "dividend" | "jcp" = "jcp") {
    const h = await petr4();
    const result = await recordDividend(USER, { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType }, prisma);
    return { h, result };
  }

  it("gives an operation that turns into a dividend the default origin of its asset class, or the one it already had", async () => {
    const { result } = await recorded("jcp");
    const toDividend = await updateDividend(USER, { operationId: result.operationId, incomeType: "dividend" }, prisma);
    expect(toDividend.origin).toBe("BR");
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } })).dividendOrigin).toBe("BR");

    const back = await updateDividend(USER, { operationId: result.operationId, incomeType: "jcp" }, prisma);
    expect(back.origin).toBeNull();

    // An operation that kept a stored origin while it was not a dividend gets it back.
    await prisma.investmentOperation.update({ where: { id: result.operationId }, data: { dividendOrigin: "BDR" } });
    const again = await updateDividend(USER, { operationId: result.operationId, incomeType: "dividend" }, prisma);
    expect(again.origin).toBe("BDR");
  });

  it("refuses a withholding edit when the stored tax already exceeds the gross", async () => {
    const h = await petr4();
    const corrupt = await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "dividend", incomeType: "dividend", dividendOrigin: "BR", totalAmount: 10, taxWithheld: 20, date: at("2026-08-05") },
    });
    await expect(updateDividend(USER, { operationId: corrupt.id, withholdingTax: 5 }, prisma)).rejects.toMatchObject({ status: 422, code: "operation.tax_exceeds_amount" });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: corrupt.id } })).toMatchObject({ totalAmount: 10, taxWithheld: 20 });
  });

  it("reports a provento whose cash leg is in the trash with no account, a generated description and the net at the rate of its date", async () => {
    const h = await vuaa();
    const result = await recordDividend(USER, { holdingId: h.id, amount: 10, date: "2026-08-12", currency: "USD", incomeType: "dividend" }, prisma);
    await prisma.ledgerEntry.update({ where: { id: result.cashEntryId! }, data: { deletedAt: new Date() } });

    const same = await updateDividend(USER, { operationId: result.operationId }, prisma);
    const fx = await loadFx(USER, prisma);
    expect(same).toMatchObject({ duplicate: true, cashAccountId: null, description: "Dividendo VUAA", batchId: null, net: 10, currency: "USD" });
    expect(same.amountBase).toBeCloseTo(round(10 * fx.rateOn("USD", at("2026-08-12")), 4), 3);
  });

  it("reports a BRL provento with no live cash leg at face value", async () => {
    const { result } = await recorded("dividend");
    await prisma.ledgerEntry.update({ where: { id: result.cashEntryId! }, data: { deletedAt: new Date() } });
    const same = await updateDividend(USER, { operationId: result.operationId }, prisma);
    expect(same).toMatchObject({ duplicate: true, cashAccountId: null, amountBase: 100, currency: "BRL" });
  });

  it("moves the cash leg to an account in another currency keeping its value in the base currency, and back", async () => {
    const { result } = await recorded("dividend");
    const moved = await updateDividend(USER, { operationId: result.operationId, cashAccountId: usdChecking.id }, prisma);
    expect(moved).toMatchObject({ duplicate: false, cashAccountId: usdChecking.id });
    const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.cashEntryId! } });
    const rate = (await loadFx(USER, prisma)).rateOn("USD", leg.date);
    expect(leg).toMatchObject({ accountId: usdChecking.id, entityId: f.pfId, currency: "USD" });
    expect(toNumber(leg.exchangeRate)).toBeCloseTo(rate, 6);
    expect(toNumber(leg.amount)).toBeCloseTo(round(100 / rate, 4), 3);
    expect(toNumber(leg.amountBase)).toBeCloseTo(100, 2);
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operationId } })).syncLocked).toBe(true);

    await updateDividend(USER, { operationId: result.operationId, cashAccountId: f.pfChecking }, prisma);
    const back = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.cashEntryId! } });
    expect(back).toMatchObject({ accountId: f.pfChecking, currency: "BRL" });
    expect(toNumber(back.exchangeRate)).toBe(1);
    expect(toNumber(back.amount)).toBeCloseTo(100, 2);
    expect(toNumber(back.amountBase)).toBeCloseTo(100, 2);
  });
});
