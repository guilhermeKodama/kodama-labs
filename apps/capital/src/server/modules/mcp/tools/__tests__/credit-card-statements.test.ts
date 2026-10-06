import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { queryLedger } from "@capital/server/modules/ledger/services/query-engine";
import { getCreditCardStatement, importCreditCardStatement, markTransactionAsCardSettlement, unmarkTransactionAsCardSettlement } from "../credit-card-statements";
import { listTransactions } from "../list-transactions";

const USER = "test-user-mcp-cc-statements-001";
const OTHER = "test-user-mcp-cc-statements-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2, categories: [{ name: "Food", type: "expense" }, { name: "Shopping", type: "expense" }] });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const purchases = (statementId: string) => prisma.ledgerEntry.findMany({ where: { cardStatementId: statementId, deletedAt: null, transferGroupId: null }, orderBy: { date: "asc" } });

describe("importCreditCardStatement", () => {
  it("creates the statement and its purchases as card outflows on the closing date", async () => {
    const r = await importCreditCardStatement(
      USER,
      {
        creditCardId: f.card,
        statement: { month: "2026-09", closingDate: "2026-09-03", dueDate: "2026-09-10", total: 150 },
        rows: [
          { date: "2026-08-10", description: "Coffee", amount: 50, category: "Food" },
          { date: "2026-08-12", description: "Shoes", amount: 100, category: "Shopping" },
        ],
      },
      prisma
    );
    expect(r).toMatchObject({ created: 2, skipped: 0 });
    const statement = await prisma.cardStatement.findUniqueOrThrow({ where: { id: r.statementId } });
    expect([statement.closingDate?.toISOString(), Number(statement.totalAmount)]).toEqual(["2026-09-03T12:00:00.000Z", 150]);
    const rows = await purchases(r.statementId);
    expect(rows.map((e) => [Number(e.amount), e.effectiveDate.toISOString().slice(0, 10), e.categoryId])).toEqual([
      [-50, "2026-09-03", f.categories.Food],
      [-100, "2026-09-03", f.categories.Shopping],
    ]);
  });

  it("treats identical rows as a multiset: within a file, across re-imports, and with installments", async () => {
    const coffee = { date: "2026-08-10", description: "Coffee", amount: 12 };
    const first = await importCreditCardStatement(USER, { creditCardId: f.card, statement: { month: "2026-09" }, rows: [coffee, coffee] }, prisma);
    expect(first.created).toBe(2);
    const again = await importCreditCardStatement(USER, { creditCardId: f.card, statement: { month: "2026-09" }, rows: [coffee, coffee, coffee] }, prisma);
    expect(again).toMatchObject({ created: 1, skipped: 2 });
    const inst = (n: number) => ({ date: "2026-05-01", description: "TV", amount: 300, installment: { number: n, total: 10 } });
    const i = await importCreditCardStatement(USER, { creditCardId: f.card, statement: { month: "2026-09" }, rows: [inst(5)] }, prisma);
    expect(i.created).toBe(1);
    expect((await importCreditCardStatement(USER, { creditCardId: f.card, statement: { month: "2026-09" }, rows: [inst(5)] }, prisma)).created).toBe(0);
    expect(await purchases(first.statementId)).toHaveLength(4);
  });

  it("imports one copy when two concurrent calls share a payload", async () => {
    const payload = { creditCardId: f.card, statement: { month: "2026-09" }, rows: [{ date: "2026-08-11", description: "Coffee", amount: 12 }] };
    const [a, b] = await Promise.all([importCreditCardStatement(USER, payload, prisma), importCreditCardStatement(USER, payload, prisma)]);
    expect(a.created + b.created).toBe(1);
    expect(await purchases(a.statementId)).toHaveLength(1);
  });

  it("matches category names case-insensitively and falls back to Other", async () => {
    const r = await importCreditCardStatement(
      USER,
      { creditCardId: f.card, statement: { month: "2026-09" }, rows: [{ date: "2026-08-10", description: "a", amount: 1, category: "food" }, { date: "2026-08-10", description: "b", amount: 1, category: "Nope" }] },
      prisma
    );
    const other = await getSystemCategory(USER, "other_system", prisma);
    expect((await purchases(r.statementId)).map((e) => e.categoryId)).toEqual([f.categories.Food, other.id]);
  });

  it("rejects another user's card", async () => {
    await createLedgerFixture(prisma, OTHER);
    await expect(importCreditCardStatement(OTHER, { creditCardId: f.card, statement: { month: "2026-09" }, rows: [] }, prisma)).rejects.toThrow(/not found/);
  });
});

describe("card settlement", () => {
  let statementId: string;
  let paymentId: string;

  beforeEach(async () => {
    ({ statementId } = await importCreditCardStatement(USER, { creditCardId: f.card, statement: { month: "2026-09" }, rows: [{ date: "2026-08-10", description: "Coffee", amount: 200, category: "Food" }] }, prisma));
    paymentId = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 200, date: "2026-09-12", description: "Pagamento Nubank" }, prisma)).entryIds[0];
  });

  it("marks a payment: it stops being an expense and becomes a card_payment transfer", async () => {
    expect(await markTransactionAsCardSettlement(USER, { transactionId: paymentId, statementId }, prisma)).toEqual({ success: true, transactionId: paymentId, statementId });
    const payment = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paymentId }, include: { transferGroup: { include: { legs: true } } } });
    expect(payment.transferGroup?.direction).toBe("card_payment");
    expect(payment.transferGroup?.legs.map((l) => [l.accountId, Number(l.amount)]).sort()).toEqual([[f.card, 200], [f.pfChecking, -200]].sort());
    // Marking twice is a no-op.
    await markTransactionAsCardSettlement(USER, { transactionId: paymentId, statementId }, prisma);
  });

  it("unmark makes the payment an expense again", async () => {
    await markTransactionAsCardSettlement(USER, { transactionId: paymentId, statementId }, prisma);
    expect(await unmarkTransactionAsCardSettlement(USER, { transactionId: paymentId }, prisma)).toEqual({ success: true, transactionId: paymentId, statementId });
    const payment = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paymentId } });
    expect([payment.kind, payment.transferGroupId]).toEqual(["expense", null]);
    await expect(unmarkTransactionAsCardSettlement(USER, { transactionId: paymentId }, prisma)).rejects.toThrow(/not linked as a card settlement/);
  });

  it("rejects a non-expense and a second payment on the same statement", async () => {
    const income = (await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 1, date: "2026-09-12", description: "x" }, prisma)).entryIds[0];
    await expect(markTransactionAsCardSettlement(USER, { transactionId: income, statementId }, prisma)).rejects.toThrow(/Only an expense/);
    await markTransactionAsCardSettlement(USER, { transactionId: paymentId, statementId }, prisma);
    const second = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 1, date: "2026-09-12", description: "y" }, prisma)).entryIds[0];
    await expect(markTransactionAsCardSettlement(USER, { transactionId: second, statementId }, prisma)).rejects.toThrow(/different bill payment/);
  });

  it("no double counting: September expenses are the purchases, not the payment", async () => {
    await markTransactionAsCardSettlement(USER, { transactionId: paymentId, statementId }, prisma);
    const r = await listTransactions(USER, { dateFrom: "2026-09-01", dateTo: "2026-09-30", type: "expense" }, prisma);
    expect(r.summaries.reduce((s, x) => s + x.total, 0)).toBe(200);
    const q = await queryLedger(USER, { period: { from: "2026-09-01", to: "2026-09-30" }, dateField: "effectiveDate", filters: [{ field: "kind", op: "in", values: ["expense"] }], groupBy: [], aggregations: [{ fn: "sum", field: "amountBase" }], includeRows: false }, prisma);
    expect(q.totals.values["sum:amountBase"]).toBe(-200);
  });
});

describe("getCreditCardStatement", () => {
  it("returns purchases, the linked payment and the reconciliation in base currency", async () => {
    const { statementId } = await importCreditCardStatement(
      USER,
      {
        creditCardId: f.card,
        statement: { month: "2026-09", total: 150 },
        rows: [
          { date: "2026-08-10", description: "Coffee", amount: 100, category: "Food" },
          { date: "2026-08-15", description: "GitHub", amount: 10, currency: "USD" },
        ],
      },
      prisma
    );
    const byMonth = await getCreditCardStatement(USER, { creditCardId: f.card, month: "2026-09" }, prisma);
    expect(byMonth.statement.id).toBe(statementId);
    expect(byMonth.purchases.map((p) => [p.description, p.amount, p.currency, p.date.slice(0, 10)])).toEqual([
      ["Coffee", 100, "BRL", "2026-08-10"],
      ["GitHub", 10, "USD", "2026-08-15"],
    ]);
    expect(byMonth.reconciliation).toMatchObject({ currency: "BRL", purchasesTotal: 150, paymentAmount: null, isReconciled: false });

    const payment = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 150, date: "2026-09-12", description: "Pagamento" }, prisma)).entryIds[0];
    await markTransactionAsCardSettlement(USER, { transactionId: payment, statementId }, prisma);
    const byId = await getCreditCardStatement(USER, { statementId }, prisma);
    expect(byId.billPayment).toMatchObject({ id: payment, amount: 150 });
    expect(byId.reconciliation).toMatchObject({ paymentAmount: 150, difference: 0, isReconciled: true });
    await expect(getCreditCardStatement(USER, {}, prisma)).rejects.toThrow(/Must provide/);
  });
});
