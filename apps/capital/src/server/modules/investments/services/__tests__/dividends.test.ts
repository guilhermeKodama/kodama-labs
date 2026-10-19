import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createHolding } from "../portfolio";
import { proventos12m } from "../proventos";
import { convertIncomeToDividend, recordDividend } from "../dividends";

const USER = "test-user-investments-dividends-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId) ?? 0;

async function petr4() {
  return createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
}

describe("record_dividend", () => {
  it("credits the cash once, defaults the description, and a repeat writes nothing", async () => {
    const h = await petr4();
    const before = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    const first = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    expect(first).toMatchObject({ duplicate: false, description: "Dividendo PETR4", origin: "BR", passiveIncome: true, net: 100, amountBase: 100 });
    const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: first.cashEntryId! } });
    expect(leg).toMatchObject({ accountId: f.pfChecking, kind: "investment", description: "Dividendo PETR4" });
    expect(toNumber(leg.amount)).toBe(100);
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(1);

    const again = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    expect(again).toMatchObject({ duplicate: true, operationId: first.operationId });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(before + 1);
  });

  it("credits the net after withholding", async () => {
    const h = await petr4();
    const result = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "jcp", withholdingTax: 15 },
      prisma,
    );
    expect(result).toMatchObject({ description: "JCP PETR4", gross: 100, withholdingTax: 15, net: 85, amountBase: 85 });
    const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.cashEntryId! } });
    expect(toNumber(leg.amount)).toBe(85);
  });

  it("converts a USD dividend at the rate of its date", async () => {
    const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const h = await createHolding(USER, { accountId: ibkr.id, assetClass: "international_etf", ticker: "VUAA", name: "VUAA", currency: "USD" }, prisma);
    const result = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 10, date: "2026-08-12", currency: "USD", incomeType: "dividend", origin: "EXTERIOR" },
      prisma,
    );
    const fx = await loadFx(USER, prisma);
    const historical = 10 * fx.rateOn("USD", new Date("2026-08-12T12:00:00Z"));
    expect(result.amountBase).toBeCloseTo(historical, 2);
    expect(result.amountBase).not.toBeCloseTo(50, 2);
    const listed = await proventos12m(USER, prisma);
    expect(listed.total).toBeCloseTo(Math.round(result.amountBase * 100) / 100, 2);
  });

  it("records PJ caixinha interest outside personal passive income", async () => {
    const broker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "PJ XP", currency: "BRL" } });
    const h = await createHolding(USER, { accountId: broker.id, assetClass: "fixed_income", name: "Caixinha", currentPrice: 1000 }, prisma);
    const result = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pjChecking, amount: 80, date: "2026-08-05", currency: "BRL", incomeType: "fixed_income_interest", withholdingTax: 10 },
      prisma,
    );
    expect(result.passiveIncome).toBe(false);
    expect(result.description).toBe("Juros Caixinha");
    expect((await proventos12m(USER, prisma)).total).toBe(0);
  });
});

describe("convert_income_to_dividend", () => {
  it("links an income row without a second credit, and a repeat is a duplicate", async () => {
    const h = await petr4();
    const category = await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } });
    const created = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 40, date: "2026-08-05", description: "MXRF11", categoryId: category.id }, prisma);
    const before = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    const cash = await balance(f.pfChecking);

    const linked = await convertIncomeToDividend(USER, { transactionId: created.entryIds[0], holdingId: h.id, incomeType: "fii_income" }, prisma);
    expect(linked).toMatchObject({ duplicate: false, cashEntryId: created.entryIds[0], passiveIncome: true, net: 40 });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(before);
    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);

    const again = await convertIncomeToDividend(USER, { transactionId: created.entryIds[0], holdingId: h.id, incomeType: "fii_income" }, prisma);
    expect(again).toMatchObject({ duplicate: true, operationId: linked.operationId });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(1);

    const listed = await proventos12m(USER, prisma);
    expect(listed.rows).toHaveLength(1);
    expect(listed.total).toBeCloseTo(40, 2);
  });

  it("does not count a transfer, and does not double an income that matches the dividend", async () => {
    const h = await petr4();
    const recorded = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 1122.88, date: "2026-08-05", currency: "BRL", incomeType: "dividend", origin: "BDR" },
      prisma,
    );
    const category = await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } });
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 1122.88, date: "2026-08-05", description: "BDR", categoryId: category.id }, prisma);
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 1122.88, date: "2026-08-05" }, prisma);
    const leg = await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: transfer.transferGroupId!, amount: { gt: 0 } } });

    await expect(convertIncomeToDividend(USER, { transactionId: leg.id, holdingId: h.id, incomeType: "dividend" }, prisma)).rejects.toMatchObject({ code: "dividend.not_income" });

    const listed = await proventos12m(USER, prisma);
    expect(listed.rows).toHaveLength(1);
    expect(listed.total).toBeCloseTo(recorded.amountBase, 2);
    expect(listed.rows[0]).toMatchObject({ source: "operation", dividendOrigin: "BDR", amountBase: recorded.amountBase });
  });
});
