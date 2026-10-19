import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createHolding, deleteOperation, updateOperation } from "../portfolio";
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

  it("refuses to credit when an unlinked income of the same net already exists", async () => {
    const h = await petr4();
    const category = await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } });
    const created = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 100, date: "2026-08-06", description: "rendimento", categoryId: category.id }, prisma);
    const before = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    const cash = await balance(f.pfChecking);

    await expect(
      recordDividend(USER, { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "dividend" }, prisma),
    ).rejects.toMatchObject({ code: "dividend.unlinked_income", params: { transactionId: created.entryIds[0] } });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(before);
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);
    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);

    const byTicker = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 55, date: "2026-08-08", description: "crédito petr4" }, prisma);
    await expect(
      recordDividend(USER, { holdingId: h.id, cashAccountId: f.pfChecking, amount: 55, date: "2026-08-10", currency: "BRL", incomeType: "dividend" }, prisma),
    ).rejects.toMatchObject({ code: "dividend.unlinked_income", params: { transactionId: byTicker.entryIds[0] } });

    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 70, date: "2026-08-05", description: "salário", categoryId: f.categories.Salary }, prisma);
    const recorded = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 70, date: "2026-08-05", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    expect(recorded.duplicate).toBe(false);
    expect(recorded.cashEntryId).not.toBeNull();
  });

  it("rejects withholding on fii income", async () => {
    const h = await petr4();
    await expect(
      recordDividend(
        USER,
        { holdingId: h.id, cashAccountId: f.pfChecking, amount: 40, date: "2026-08-05", currency: "BRL", incomeType: "fii_income", withholdingTax: 1 },
        prisma,
      ),
    ).rejects.toMatchObject({ code: "dividend.fii_withholding" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);

    const created = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 40, date: "2026-08-05", description: "FII" }, prisma);
    await expect(
      convertIncomeToDividend(USER, { transactionId: created.entryIds[0], holdingId: h.id, incomeType: "fii_income", withholdingTax: 0.01 }, prisma),
    ).rejects.toMatchObject({ code: "dividend.fii_withholding" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);

    const ok = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 40, date: "2026-08-05", currency: "BRL", incomeType: "fii_income" },
      prisma,
    );
    expect(ok.withholdingTax).toBe(0);
  });

  it("rejects a cash account on a different entity", async () => {
    const h = await petr4();
    const before = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    await expect(
      recordDividend(USER, { holdingId: h.id, cashAccountId: f.pjChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "dividend" }, prisma),
    ).rejects.toMatchObject({ code: "dividend.entity_mismatch" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(before);
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

  it("attaches a legacy dividend with no cash leg and rejects extra cash when one already has a leg", async () => {
    const h = await petr4();
    const legacy = await prisma.investmentOperation.create({
      data: {
        holdingId: h.id,
        type: "dividend",
        totalAmount: 40,
        taxWithheld: 0,
        incomeType: "dividend",
        dividendOrigin: "BR",
        date: new Date("2026-08-05T12:00:00Z"),
      },
    });
    const category = await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } });
    const created = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 40, date: "2026-08-05", description: "PETR4", categoryId: category.id }, prisma);
    const before = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    const cash = await balance(f.pfChecking);

    const attached = await convertIncomeToDividend(USER, { transactionId: created.entryIds[0], holdingId: h.id, incomeType: "dividend" }, prisma);
    expect(attached).toMatchObject({ duplicate: false, operationId: legacy.id, cashEntryId: created.entryIds[0] });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(before);
    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);

    const recorded = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 80, date: "2026-09-01", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    const extra = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 80, date: "2026-09-02", description: "PETR4 de novo", categoryId: category.id }, prisma);
    const entriesAfter = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    const cashAfter = await balance(f.pfChecking);
    await expect(
      convertIncomeToDividend(USER, { transactionId: extra.entryIds[0], holdingId: h.id, incomeType: "dividend" }, prisma),
    ).rejects.toMatchObject({ code: "dividend.extra_cash", params: { operationId: recorded.operationId, transactionId: extra.entryIds[0] } });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(2);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(entriesAfter);
    expect(await balance(f.pfChecking)).toBeCloseTo(cashAfter, 4);
    const still = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: extra.entryIds[0] } });
    expect(still.deletedAt).toBeNull();
    expect((still.metadata as { investmentOperationId?: string } | null)?.investmentOperationId).toBeUndefined();
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).cashEntryId).toBe(recorded.cashEntryId);
  });

  it("matches an existing dividend in the base currency, not the holding currency against the entry currency", async () => {
    const ibkr = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "IBKR", currency: "USD" } });
    const h = await createHolding(USER, { accountId: ibkr.id, assetClass: "international_etf", ticker: "VUAA", name: "VUAA", currency: "USD" }, prisma);
    const legacy = await prisma.investmentOperation.create({
      data: {
        holdingId: h.id,
        type: "dividend",
        totalAmount: 10,
        taxWithheld: 0,
        incomeType: "dividend",
        dividendOrigin: "EXTERIOR",
        date: new Date("2026-08-12T12:00:00Z"),
      },
    });
    const fx = await loadFx(USER, prisma);
    const base = 10 * fx.rateOn("USD", new Date("2026-08-12T12:00:00Z"));
    expect(base).toBeGreaterThan(20);

    const decoy = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 10, date: "2026-08-12", description: "VUAA" }, prisma);
    const separate = await convertIncomeToDividend(
      USER,
      { transactionId: decoy.entryIds[0], holdingId: h.id, incomeType: "dividend", origin: "EXTERIOR" },
      prisma,
    );
    expect(separate).toMatchObject({ duplicate: false, cashEntryId: decoy.entryIds[0] });
    expect(separate.operationId).not.toBe(legacy.id);
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: legacy.id } })).cashEntryId).toBeNull();

    const real = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: base, date: "2026-08-12", description: "VUAA base" }, prisma);
    const attached = await convertIncomeToDividend(
      USER,
      { transactionId: real.entryIds[0], holdingId: h.id, incomeType: "dividend", origin: "EXTERIOR" },
      prisma,
    );
    expect(attached).toMatchObject({ duplicate: false, operationId: legacy.id, cashEntryId: real.entryIds[0] });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(2);
  });

  it("unlinks adopted income when the operation is deleted or edited", async () => {
    const h = await petr4();
    const created = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 40, date: "2026-08-05", description: "PETR4" }, prisma);
    const linked = await convertIncomeToDividend(USER, { transactionId: created.entryIds[0], holdingId: h.id, incomeType: "dividend" }, prisma);
    const cash = await balance(f.pfChecking);

    await deleteOperation(USER, linked.operationId, prisma);
    const kept = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } });
    expect(kept.deletedAt).toBeNull();
    expect(kept.kind).toBe("income");
    expect(toNumber(kept.amount)).toBe(40);
    expect(kept.description).toBe("PETR4");
    const meta = kept.metadata as { holdingId?: string; investmentOperationId?: string } | null;
    expect(meta?.holdingId).toBeUndefined();
    expect(meta?.investmentOperationId).toBeUndefined();
    expect(await prisma.investmentOperation.findUnique({ where: { id: linked.operationId } })).toBeNull();
    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);

    const again = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 25, date: "2026-08-12", description: "PETR4 jcp" }, prisma);
    const second = await convertIncomeToDividend(
      USER,
      { transactionId: again.entryIds[0], holdingId: h.id, incomeType: "jcp", withholdingTax: 3 },
      prisma,
    );
    const original = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: again.entryIds[0] } });
    const cash2 = await balance(f.pfChecking);
    await updateOperation(USER, second.operationId, { date: "2026-08-20", taxWithheld: 1 }, prisma);
    const edited = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: again.entryIds[0] } });
    expect(edited.deletedAt).toBeNull();
    expect(edited.kind).toBe("income");
    expect(toNumber(edited.amount)).toBe(toNumber(original.amount));
    expect(edited.date.toISOString()).toBe(original.date.toISOString());
    expect(edited.accountId).toBe(original.accountId);
    expect(edited.description).toBe(original.description);
    const editedMeta = edited.metadata as { investmentOperationId?: string; holdingId?: string } | null;
    expect(editedMeta?.investmentOperationId).toBeUndefined();
    expect(editedMeta?.holdingId).toBeUndefined();
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: second.operationId } })).cashEntryId).toBeNull();
    expect(await balance(f.pfChecking)).toBeCloseTo(cash2, 4);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, accountId: f.pfChecking, deletedAt: null, kind: "investment" } })).toBe(0);
  });
});
