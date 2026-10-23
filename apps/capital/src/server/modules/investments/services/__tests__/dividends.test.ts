import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { listInvestmentPositions } from "@capital/server/modules/mcp/tools/investments";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { listAccountBalances } from "@capital/server/modules/mcp/tools/balances";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { createHolding, deleteOperation, recordOperation, updateOperation } from "../portfolio";
import { proventos12m } from "../proventos";
import { convertIncomeToDividend, recordDividend, updateDividend } from "../dividends";

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

  it("credits a brokerage account's cash balance, including when the account is omitted", async () => {
    const h = await petr4();
    const brokerBefore = await balance(f.broker);
    const checkingBefore = await balance(f.pfChecking);
    const result = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.broker, amount: 40, date: "2026-08-05", currency: "BRL", incomeType: "fii_income" },
      prisma,
    );
    expect(result).toMatchObject({ cashAccountId: f.broker, net: 40, duplicate: false });
    const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.cashEntryId! } });
    expect(leg).toMatchObject({ accountId: f.broker, kind: "investment" });
    expect(toNumber(leg.amount)).toBe(40);
    expect(await balance(f.broker)).toBeCloseTo(brokerBefore + 40, 4);
    expect(await balance(f.pfChecking)).toBeCloseTo(checkingBefore, 4);

    const listed = await listAccountBalances(USER, {}, prisma);
    const row = listed.accounts.find((account) => account.id === f.broker);
    expect(row).toMatchObject({ type: "brokerage", name: "XP" });
    expect(row?.balance).toBeCloseTo(brokerBefore + 40, 2);

    const omitted = await recordDividend(
      USER,
      { holdingId: h.id, amount: 12, date: "2026-08-06", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    expect(omitted.cashAccountId).toBe(f.broker);
    expect(await balance(f.broker)).toBeCloseTo(brokerBefore + 52, 4);
    expect(await balance(f.pfChecking)).toBeCloseTo(checkingBefore, 4);
  });

  it("rejects a credit card and another user's brokerage", async () => {
    const h = await petr4();
    const before = await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } });
    await expect(
      recordDividend(USER, { holdingId: h.id, cashAccountId: f.card, amount: 10, date: "2026-08-05", currency: "BRL", incomeType: "dividend" }, prisma),
    ).rejects.toMatchObject({ code: "operation.credit_account_invalid" });
    expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(before);

    const other = "test-user-investments-dividends-broker-002";
    const otherFixture = await createLedgerFixture(prisma, other);
    try {
      await expect(
        recordDividend(other, { holdingId: h.id, cashAccountId: otherFixture.broker, amount: 10, date: "2026-08-05", currency: "BRL", incomeType: "dividend" }, prisma),
      ).rejects.toMatchObject({ code: "holding.not_found" });
      await expect(
        recordDividend(USER, { holdingId: h.id, cashAccountId: otherFixture.broker, amount: 10, date: "2026-08-05", currency: "BRL", incomeType: "dividend" }, prisma),
      ).rejects.toMatchObject({ code: "account.not_found" });
      expect(await prisma.investmentOperation.count({ where: { holdingId: h.id } })).toBe(0);
    } finally {
      await deleteLedgerFixture(prisma, other);
    }
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

  it("links income already on a brokerage and rejects income on a credit card", async () => {
    const h = await petr4();
    const onBroker = await createEntry(USER, { kind: "income", accountId: f.broker, amount: 18, date: "2026-08-09", description: "MXRF11" }, prisma);
    const brokerBefore = await balance(f.broker);
    const linked = await convertIncomeToDividend(USER, { transactionId: onBroker.entryIds[0], holdingId: h.id, incomeType: "fii_income" }, prisma);
    expect(linked).toMatchObject({ cashAccountId: f.broker, cashEntryId: onBroker.entryIds[0], net: 18, duplicate: false });
    expect(await balance(f.broker)).toBeCloseTo(brokerBefore, 4);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: onBroker.entryIds[0] } })).kind).toBe("income");

    const onCard = await createEntry(USER, { kind: "income", accountId: f.card, amount: 9, date: "2026-08-09", description: "rendimento" }, prisma);
    await expect(
      convertIncomeToDividend(USER, { transactionId: onCard.entryIds[0], holdingId: h.id, incomeType: "dividend" }, prisma),
    ).rejects.toMatchObject({ code: "operation.credit_account_invalid" });
    expect(await prisma.investmentOperation.count({ where: { cashEntryId: onCard.entryIds[0] } })).toBe(0);
  });
});

describe("update_dividend", () => {
  it("sets origin and withholding on a kind-investment cash leg without moving the balance, and a repeat writes nothing", async () => {
    const h = await petr4();
    const recorded = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    const legBefore = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } });
    const cash = await balance(f.pfChecking);
    const entries = await prisma.ledgerEntry.count({ where: { userId: USER } });
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });

    const updated = await updateDividend(USER, { operationId: recorded.operationId, origin: "BDR", incomeType: "dividend", withholdingTax: 15 }, prisma);
    expect(updated).toMatchObject({ duplicate: false, origin: "BDR", incomeType: "dividend", withholdingTax: 15, gross: 115, net: 100, amountBase: 100 });
    expect(updated.batchId).toEqual(expect.any(String));
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } });
    expect(op).toMatchObject({ type: "dividend", incomeType: "dividend", dividendOrigin: "BDR", taxWithheld: 15, totalAmount: 115, cashEntryId: recorded.cashEntryId });
    const legAfter = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } });
    expect(legAfter.kind).toBe("investment");
    expect(toNumber(legAfter.amount)).toBe(toNumber(legBefore.amount));
    expect(toNumber(legAfter.amountBase)).toBe(toNumber(legBefore.amountBase));
    expect(legAfter.updatedAt).toEqual(legBefore.updatedAt);
    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entries);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches + 1);

    const again = await updateDividend(USER, { operationId: recorded.operationId, origin: "BDR", incomeType: "dividend", withholdingTax: 15 }, prisma);
    expect(again).toMatchObject({ duplicate: true, batchId: null, operationId: recorded.operationId, gross: 115 });
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches + 1);
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).totalAmount).toBe(115);

    await undoBatch(USER, updated.batchId!, prisma);
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).toMatchObject({
      dividendOrigin: "BR",
      taxWithheld: 0,
      totalAmount: 100,
    });
    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);
    expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } })).amount)).toBe(100);
  });

  it("rejects a buy, withholding above the gross, and withholding on fii income", async () => {
    const h = await petr4();
    const recorded = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 100, date: "2026-08-05", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    const cash = await balance(f.pfChecking);
    const entries = await prisma.ledgerEntry.count({ where: { userId: USER } });

    await expect(updateDividend(USER, { operationId: recorded.operationId, withholdingTax: 100.01 }, prisma)).rejects.toMatchObject({ code: "operation.tax_exceeds_amount" });
    await expect(updateDividend(USER, { operationId: recorded.operationId, incomeType: "fii_income", withholdingTax: 1 }, prisma)).rejects.toMatchObject({
      code: "dividend.fii_withholding",
    });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).toMatchObject({
      incomeType: "dividend",
      taxWithheld: 0,
      totalAmount: 100,
      dividendOrigin: "BR",
    });

    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 2, pricePerUnit: 10, totalAmount: 20, date: "2026-08-01" }, prisma);
    await expect(updateDividend(USER, { operationId: recorded.operationId, incomeType: "jcp", origin: "EXTERIOR" }, prisma)).rejects.toMatchObject({
      code: "dividend.origin_not_dividend",
    });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).toMatchObject({
      incomeType: "dividend",
      dividendOrigin: "BR",
    });
    await expect(updateDividend(USER, { operationId: buy.operation.id, origin: "BR" }, prisma)).rejects.toMatchObject({ code: "dividend.not_income_operation" });
    await expect(updateDividend(USER, { operationId: "00000000-0000-0000-0000-000000000000", origin: "BR" }, prisma)).rejects.toMatchObject({ code: "operation.not_found" });

    const asYield = await updateDividend(USER, { operationId: recorded.operationId, incomeType: "fixed_income_interest", withholdingTax: 10 }, prisma);
    expect(asYield).toMatchObject({ duplicate: false, incomeType: "fixed_income_interest", origin: null, withholdingTax: 10, gross: 110, net: 100 });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).toMatchObject({
      type: "yield_payment",
      dividendOrigin: null,
      taxWithheld: 10,
      totalAmount: 110,
    });
    const cleared = await updateDividend(USER, { operationId: recorded.operationId, incomeType: "fii_income", withholdingTax: 0 }, prisma);
    expect(cleared).toMatchObject({ incomeType: "fii_income", withholdingTax: 0, origin: null, gross: 100, net: 100 });

    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entries + 1);
  });

  it("does not rewrite an income entry that was linked with convert_income_to_dividend", async () => {
    const h = await petr4();
    const created = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 40, date: "2026-08-05", description: "PETR4" }, prisma);
    const linked = await convertIncomeToDividend(USER, { transactionId: created.entryIds[0], holdingId: h.id, incomeType: "dividend" }, prisma);
    const before = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } });
    const cash = await balance(f.pfChecking);
    const entries = await prisma.ledgerEntry.count({ where: { userId: USER } });

    const updated = await updateDividend(USER, { operationId: linked.operationId, origin: "EXTERIOR", withholdingTax: 5 }, prisma);
    expect(updated).toMatchObject({ duplicate: false, origin: "EXTERIOR", withholdingTax: 5, gross: 45, net: 40 });
    const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } });
    expect(after.kind).toBe("income");
    expect(toNumber(after.amount)).toBe(toNumber(before.amount));
    expect(toNumber(after.amountBase)).toBe(toNumber(before.amountBase));
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.metadata).toEqual(before.metadata);
    expect(await balance(f.pfChecking)).toBeCloseTo(cash, 4);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entries);
  });

  it("treats a legacy FII dividend with no income type as tax-exempt", async () => {
    const fii = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "MXRF11", name: "Maxi Renda" }, prisma);
    const legacy = await recordOperation(USER, { holdingId: fii.id, type: "dividend", totalAmount: 50, date: "2026-08-05" }, prisma);
    expect(legacy.operation.incomeType).toBeNull();
    await expect(updateDividend(USER, { operationId: legacy.operation.id, withholdingTax: 1 }, prisma)).rejects.toMatchObject({ code: "dividend.fii_withholding" });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: legacy.operation.id } })).toMatchObject({ incomeType: null, taxWithheld: 0 });

    const taxed = await recordOperation(USER, { holdingId: fii.id, type: "dividend", totalAmount: 40, taxWithheld: 5, date: "2026-08-06" }, prisma);
    await expect(updateDividend(USER, { operationId: taxed.operation.id, origin: "BR" }, prisma)).rejects.toMatchObject({ code: "dividend.fii_withholding" });

    const stock = await petr4();
    const plain = await recordOperation(USER, { holdingId: stock.id, type: "dividend", totalAmount: 20, taxWithheld: 2, date: "2026-08-07" }, prisma);
    const updated = await updateDividend(USER, { operationId: plain.operation.id, origin: "BDR" }, prisma);
    expect(updated).toMatchObject({ origin: "BDR", withholdingTax: 2 });
  });

  it("accepts the cash entry id of a dividend on a closed holding and rejects an entry that is not one", async () => {
    const h = await petr4();
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 8, pricePerUnit: 40, totalAmount: 320, date: "2026-07-01" }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 8, pricePerUnit: 42, totalAmount: 336, date: "2026-08-05" }, prisma);
    const recorded = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 25, date: "2026-08-20", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    expect((await listInvestmentPositions(USER, prisma, { ticker: "PETR4", includeClosed: true })).positions[0]).toMatchObject({
      id: h.id,
      currentQuantity: 0,
      closedAt: "2026-08-05",
    });

    const cashBefore = await balance(f.pfChecking);
    const legBefore = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } });
    const updated = await updateDividend(USER, { operationId: recorded.cashEntryId!, origin: "BDR", withholdingTax: 5 }, prisma);
    expect(updated).toMatchObject({
      duplicate: false,
      operationId: recorded.operationId,
      origin: "BDR",
      withholdingTax: 5,
      gross: 30,
      net: 25,
      batchId: expect.any(String),
    });
    const legAfter = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } });
    expect(legAfter.kind).toBe("investment");
    expect(toNumber(legAfter.amount)).toBe(toNumber(legBefore.amount));
    expect(toNumber(legAfter.amountBase)).toBe(toNumber(legBefore.amountBase));
    expect(legAfter.updatedAt).toEqual(legBefore.updatedAt);
    expect(await balance(f.pfChecking)).toBeCloseTo(cashBefore, 4);
    expect((await listInvestmentPositions(USER, prisma, { ticker: "PETR4", includeClosed: true })).positions[0]).toMatchObject({
      id: h.id,
      currentQuantity: 0,
      closedAt: "2026-08-05",
    });

    const again = await updateDividend(USER, { operationId: recorded.cashEntryId!, origin: "BDR", withholdingTax: 5 }, prisma);
    expect(again).toMatchObject({ duplicate: true, batchId: null, operationId: recorded.operationId, gross: 30 });

    await expect(updateDividend(USER, { operationId: recorded.cashEntryId!, withholdingTax: 30.01 }, prisma)).rejects.toMatchObject({
      code: "operation.tax_exceeds_amount",
    });
    await expect(updateDividend(USER, { operationId: recorded.cashEntryId!, incomeType: "jcp", origin: "EXTERIOR" }, prisma)).rejects.toMatchObject({
      code: "dividend.origin_not_dividend",
    });

    const salary = (await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 10, date: "2026-08-21", description: "Salário" }, prisma)).entryIds[0];
    await expect(updateDividend(USER, { operationId: salary, origin: "BR" }, prisma)).rejects.toMatchObject({
      code: "dividend.entry_not_dividend",
      params: { transactionId: salary },
    });

    const buy = await recordOperation(
      USER,
      { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 10, totalAmount: 10, date: "2026-08-22", fundFromAccountId: f.pfChecking },
      prisma,
    );
    await expect(updateDividend(USER, { operationId: buy.cashEntryId!, origin: "BR" }, prisma)).rejects.toMatchObject({
      code: "dividend.entry_not_dividend",
      params: { transactionId: buy.cashEntryId },
    });
    const fundingLeg = await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: buy.fundingGroupId!, userId: USER } });
    await expect(updateDividend(USER, { operationId: fundingLeg.id, origin: "BR" }, prisma)).rejects.toMatchObject({
      code: "dividend.entry_not_dividend",
      params: { transactionId: fundingLeg.id },
    });
    await expect(updateDividend(USER, { operationId: buy.operation.id, origin: "BR" }, prisma)).rejects.toMatchObject({
      code: "dividend.not_income_operation",
    });

    const linked = await convertIncomeToDividend(
      USER,
      { transactionId: salary, holdingId: h.id, incomeType: "dividend", withholdingTax: 2 },
      prisma,
    );
    const fromIncome = await updateDividend(USER, { operationId: salary, origin: "EXTERIOR" }, prisma);
    expect(fromIncome).toMatchObject({ duplicate: false, operationId: linked.operationId, origin: "EXTERIOR", withholdingTax: 2, net: 10 });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: salary } })).kind).toBe("income");

    const other = "test-user-investments-dividends-002";
    await createLedgerFixture(prisma, other);
    try {
      await expect(updateDividend(other, { operationId: recorded.operationId, origin: "EXTERIOR" }, prisma)).rejects.toMatchObject({ code: "operation.not_found" });
      await expect(updateDividend(other, { operationId: recorded.cashEntryId!, origin: "EXTERIOR" }, prisma)).rejects.toMatchObject({ code: "operation.not_found" });
      await expect(updateDividend(other, { operationId: salary, origin: "EXTERIOR" }, prisma)).rejects.toMatchObject({ code: "operation.not_found" });
    } finally {
      await deleteLedgerFixture(prisma, other);
    }

    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).toMatchObject({
      dividendOrigin: "BDR",
      taxWithheld: 5,
      totalAmount: 30,
      cashEntryId: recorded.cashEntryId,
    });
  });

  it("moves the cash leg from checking to the brokerage and back, and keeps the amounts", async () => {
    const h = await petr4();
    const recorded = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 80, date: "2026-08-05", currency: "BRL", incomeType: "fii_income" },
      prisma,
    );
    const legBefore = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } });
    const checkingBefore = await balance(f.pfChecking);
    const brokerBefore = await balance(f.broker);

    const moved = await updateDividend(USER, { operationId: recorded.operationId, cashAccountId: f.broker }, prisma);
    expect(moved).toMatchObject({
      duplicate: false,
      operationId: recorded.operationId,
      cashAccountId: f.broker,
      gross: 80,
      withholdingTax: 0,
      net: 80,
      origin: null,
      incomeType: "fii_income",
      date: "2026-08-05",
    });
    const onBroker = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } });
    expect(onBroker).toMatchObject({ accountId: f.broker, kind: "investment", description: legBefore.description, currency: "BRL" });
    expect(onBroker.date).toEqual(legBefore.date);
    expect(toNumber(onBroker.amount)).toBe(toNumber(legBefore.amount));
    expect(toNumber(onBroker.amountBase)).toBe(toNumber(legBefore.amountBase));
    expect(await balance(f.pfChecking)).toBeCloseTo(checkingBefore - 80, 4);
    expect(await balance(f.broker)).toBeCloseTo(brokerBefore + 80, 4);
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operationId } })).toMatchObject({
      totalAmount: 80,
      taxWithheld: 0,
      incomeType: "fii_income",
      dividendOrigin: null,
      syncLocked: true,
      cashEntryId: recorded.cashEntryId,
    });

    const again = await updateDividend(USER, { operationId: recorded.cashEntryId!, cashAccountId: f.broker }, prisma);
    expect(again).toMatchObject({ duplicate: true, batchId: null, cashAccountId: f.broker });

    const back = await updateDividend(USER, { operationId: recorded.cashEntryId!, cashAccountId: f.pfChecking }, prisma);
    expect(back.cashAccountId).toBe(f.pfChecking);
    const restored = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } });
    expect(restored.accountId).toBe(f.pfChecking);
    expect(toNumber(restored.amount)).toBe(80);
    expect(restored.date).toEqual(legBefore.date);
    expect(await balance(f.pfChecking)).toBeCloseTo(checkingBefore, 4);
    expect(await balance(f.broker)).toBeCloseTo(brokerBefore, 4);

    await undoBatch(USER, back.batchId!, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: recorded.cashEntryId! } })).accountId).toBe(f.broker);
    expect(await balance(f.broker)).toBeCloseTo(brokerBefore + 80, 4);
    expect(await balance(f.pfChecking)).toBeCloseTo(checkingBefore - 80, 4);
  });

  it("moves an adopted income without rewriting its amount, and rejects a card, another user, and a missing leg", async () => {
    const h = await petr4();
    const created = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 33, date: "2026-08-11", description: "HGLG11 rendimento" }, prisma);
    const linked = await convertIncomeToDividend(USER, { transactionId: created.entryIds[0], holdingId: h.id, incomeType: "fii_income" }, prisma);
    const before = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } });
    const checkingBefore = await balance(f.pfChecking);
    const brokerBefore = await balance(f.broker);

    const moved = await updateDividend(USER, { operationId: created.entryIds[0], cashAccountId: f.broker }, prisma);
    expect(moved).toMatchObject({ cashAccountId: f.broker, net: 33, gross: 33, incomeType: "fii_income" });
    const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } });
    expect(after.kind).toBe("income");
    expect(after.accountId).toBe(f.broker);
    expect(toNumber(after.amount)).toBe(toNumber(before.amount));
    expect(toNumber(after.amountBase)).toBe(toNumber(before.amountBase));
    expect(after.date).toEqual(before.date);
    expect(after.description).toBe(before.description);
    expect(after.metadata).toEqual(before.metadata);
    expect(await balance(f.pfChecking)).toBeCloseTo(checkingBefore - 33, 4);
    expect(await balance(f.broker)).toBeCloseTo(brokerBefore + 33, 4);

    await expect(updateDividend(USER, { operationId: linked.operationId, cashAccountId: f.card }, prisma)).rejects.toMatchObject({
      code: "operation.credit_account_invalid",
    });
    await expect(updateDividend(USER, { operationId: linked.operationId, cashAccountId: f.pjChecking }, prisma)).rejects.toMatchObject({
      code: "dividend.entity_mismatch",
    });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } })).accountId).toBe(f.broker);

    const legacy = await recordOperation(USER, { holdingId: h.id, type: "dividend", totalAmount: 10, taxWithheld: 10, date: "2026-08-12" }, prisma);
    expect(legacy.cashEntryId).toBeNull();
    await expect(updateDividend(USER, { operationId: legacy.operation.id, cashAccountId: f.broker }, prisma)).rejects.toMatchObject({
      code: "dividend.no_cash_leg",
    });

    const other = "test-user-investments-dividends-move-002";
    const otherFixture = await createLedgerFixture(prisma, other);
    try {
      await expect(updateDividend(other, { operationId: linked.operationId, cashAccountId: otherFixture.broker }, prisma)).rejects.toMatchObject({
        code: "operation.not_found",
      });
      await expect(updateDividend(other, { operationId: created.entryIds[0], cashAccountId: otherFixture.broker }, prisma)).rejects.toMatchObject({
        code: "operation.not_found",
      });
      await expect(updateDividend(USER, { operationId: linked.operationId, cashAccountId: otherFixture.broker }, prisma)).rejects.toMatchObject({
        code: "account.not_found",
      });
    } finally {
      await deleteLedgerFixture(prisma, other);
    }
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: created.entryIds[0] } })).accountId).toBe(f.broker);
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: linked.operationId } })).toMatchObject({
      totalAmount: 33,
      taxWithheld: 0,
      incomeType: "fii_income",
    });
  });
});
