import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createBudget as createBudgetService } from "@capital/server/modules/budgets/services/budget-crud";
import { monthOverview } from "@capital/server/modules/budgets/services/budget-overview";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { markStatementPayment } from "@capital/server/modules/ledger/services/statements";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createBudget, deleteBudget, getBudgetComposition, getBudgetStatus, listBudgets, updateBudget } from "../budgets";

const USER = "test-user-mcp-budgets-001";
const OTHER = "test-user-mcp-budgets-002";
let f: LedgerFixture;
let other: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    usdRate: 0.2,
    categories: [
      { name: "Shopping", type: "expense" },
      { name: "Food", type: "expense" },
      { name: "Salary", type: "income" },
    ],
  });
  other = await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const budget = (overrides: Record<string, unknown> = {}) => ({ accountId: f.pfId, category: "Shopping", amount: 2800, currency: "BRL", effectiveFrom: "2026-10-01", ...overrides });
const expense = (amount: number, date: string, categoryId: string, extra: Record<string, unknown> = {}) =>
  createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount, date, description: "x", categoryId, ...extra }, prisma, { skipRules: true });

describe("create_budget", () => {
  it("creates a monthly budget normalized to the first of the month", async () => {
    const b = await createBudget(USER, budget({ effectiveFrom: "2026-10-17" }), prisma);
    expect(b).toMatchObject({ category: "Shopping", amount: 2800, currency: "BRL", effectiveFrom: "2026-10-01", period: "monthly", year: 2026, month: 10 });
  });

  it("reactivates an inactive budget instead of failing, and rejects an active duplicate", async () => {
    const b = await createBudget(USER, budget(), prisma);
    await deleteBudget(USER, { budgetId: b.id }, prisma);
    const again = await createBudget(USER, budget({ amount: 3000 }), prisma);
    expect([again.id, again.amount]).toEqual([b.id, 3000]);
    await expect(createBudget(USER, budget(), prisma)).rejects.toThrow(/already starts in that month/);
  });

  it("rejects negative amounts, foreign accounts and unknown categories; allows several effective dates", async () => {
    await expect(createBudget(USER, budget({ amount: -1 }), prisma)).rejects.toThrow(/non-negative/);
    await expect(createBudget(USER, budget({ accountId: other.pfId }), prisma)).rejects.toThrow(/not found/);
    await expect(createBudget(USER, budget({ category: "Nope" }), prisma)).rejects.toThrow(/not found/);
    await createBudget(USER, budget(), prisma);
    await createBudget(USER, budget({ amount: 2000, effectiveFrom: "2026-12-01" }), prisma);
    expect(await listBudgets(USER, { category: "Shopping" }, prisma)).toHaveLength(2);
  });
});

describe("list_budgets", () => {
  beforeEach(async () => {
    await createBudget(USER, budget(), prisma);
    await createBudget(USER, budget({ amount: 2000, effectiveFrom: "2026-12-01" }), prisma);
    await createBudget(USER, budget({ category: "Food", amount: 1500 }), prisma);
  });

  it("lists all active budgets or filters by category", async () => {
    expect(await listBudgets(USER, {}, prisma)).toHaveLength(3);
    expect((await listBudgets(USER, { category: "Food" }, prisma)).map((b) => b.amount)).toEqual([1500]);
  });

  it("returns the budget in force at a date, one per category", async () => {
    const nov = await listBudgets(USER, { effectiveDate: "2026-11" }, prisma);
    expect(Object.fromEntries(nov.map((b) => [b.category, b.amount]))).toEqual({ Shopping: 2800, Food: 1500 });
    const jan = await listBudgets(USER, { effectiveDate: "2027-01-15" }, prisma);
    expect(Object.fromEntries(jan.map((b) => [b.category, b.amount]))).toEqual({ Shopping: 2000, Food: 1500 });
    expect(await listBudgets(USER, { effectiveDate: "2026-09" }, prisma)).toEqual([]);
  });
});

describe("update_budget / delete_budget", () => {
  it("updates amount, currency, effective date and active flag; guards ownership and duplicates", async () => {
    const b = await createBudget(USER, budget(), prisma);
    await createBudget(USER, budget({ effectiveFrom: "2026-12-01" }), prisma);
    expect((await updateBudget(USER, { budgetId: b.id, amount: 100, currency: "USD" }, prisma))).toMatchObject({ amount: 100, currency: "USD" });
    expect((await updateBudget(USER, { budgetId: b.id, effectiveFrom: "2026-11-01" }, prisma)).effectiveFrom).toBe("2026-11-01");
    await expect(updateBudget(USER, { budgetId: b.id, effectiveFrom: "2026-12-01" }, prisma)).rejects.toThrow(/already starts/);
    await expect(updateBudget(USER, { budgetId: b.id, amount: -1 }, prisma)).rejects.toThrow(/non-negative/);
    await expect(updateBudget(OTHER, { budgetId: b.id, amount: 1 }, prisma)).rejects.toThrow(/not found/);
    expect((await updateBudget(USER, { budgetId: b.id, isActive: false }, prisma)).isActive).toBe(false);
  });

  it("applyFrom versions from that month and leaves earlier months; omitting it rewrites the version in place", async () => {
    const oct = await createBudget(USER, budget({ amount: 2800, effectiveFrom: "2026-10-01" }), prisma);
    const fromDec = await updateBudget(USER, { budgetId: oct.id, amount: 2000, applyFrom: "2026-12" }, prisma);
    expect(fromDec.id).not.toBe(oct.id);
    expect(fromDec).toMatchObject({ amount: 2000, effectiveFrom: "2026-12-01" });
    const nov = await listBudgets(USER, { effectiveDate: "2026-11" }, prisma);
    expect(nov.find((b) => b.category === "Shopping")).toMatchObject({ id: oct.id, amount: 2800 });
    const dec = await listBudgets(USER, { effectiveDate: "2026-12" }, prisma);
    expect(dec.find((b) => b.category === "Shopping")).toMatchObject({ id: fromDec.id, amount: 2000 });

    const rewritten = await updateBudget(USER, { budgetId: oct.id, amount: 1500 }, prisma);
    expect(rewritten).toMatchObject({ id: oct.id, amount: 1500, effectiveFrom: "2026-10-01" });
    expect((await listBudgets(USER, { effectiveDate: "2026-11" }, prisma)).find((b) => b.category === "Shopping")?.amount).toBe(1500);
    expect((await listBudgets(USER, { effectiveDate: "2026-12" }, prisma)).find((b) => b.category === "Shopping")?.amount).toBe(2000);

    await expect(updateBudget(USER, { budgetId: oct.id, amount: 1, applyFrom: "2026-12", effectiveFrom: "2026-11-01" }, prisma)).rejects.toThrow(/applyFrom cannot be combined/);
    await expect(updateBudget(USER, { budgetId: oct.id, amount: -1, applyFrom: "2026-12" }, prisma)).rejects.toThrow(/non-negative/);
    await expect(updateBudget(OTHER, { budgetId: oct.id, amount: 1, applyFrom: "2026-12" }, prisma)).rejects.toThrow(/not found/);
  });

  it("soft deletes", async () => {
    const b = await createBudget(USER, budget(), prisma);
    expect(await deleteBudget(USER, { budgetId: b.id }, prisma)).toEqual({ success: true, budgetId: b.id });
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: b.id } })).isActive).toBe(false);
    await expect(deleteBudget(OTHER, { budgetId: b.id }, prisma)).rejects.toThrow(/not found/);
  });
});

describe("get_budget_status", () => {
  beforeEach(async () => {
    await createBudget(USER, budget(), prisma);
    await createBudget(USER, budget({ amount: 2000, effectiveFrom: "2026-12-01" }), prisma);
    await createBudget(USER, budget({ category: "Food", amount: 1500 }), prisma);
    // 1000 + 200 USD at 5 BRL/USD = 6000 BRL of Shopping, 100 USD = 500 BRL of Food.
    await expense(1000, "2026-10-15", f.categories.Shopping, { currency: "USD" });
    await expense(200, "2026-10-20", f.categories.Shopping, { currency: "USD" });
    await expense(100, "2026-10-10", f.categories.Food, { currency: "USD" });
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 500, date: "2026-10-05", description: "income", categoryId: f.categories.Salary }, prisma);
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 700, date: "2026-10-06", direction: "investment_deposit" }, prisma);
  });

  it("compares budgeted vs actual in base currency, expenses only", async () => {
    const r = await getBudgetStatus(USER, { month: "2026-10", accountId: f.pfId }, prisma);
    expect(r).toMatchObject({ month: "2026-10", accountId: f.pfId, budgetCurrency: "BRL", summary: { totalBudgeted: 4300, totalActual: 6500, totalRemaining: -2200 } });
    expect(r.categories.map((c) => [c.category, c.budgeted, c.actual, c.isOverBudget])).toEqual([
      ["Shopping", 2800, 6000, true],
      ["Food", 1500, 500, false],
    ]);
  });

  it("uses the budget in force for the month and validates input", async () => {
    const dec = await getBudgetStatus(USER, { month: "2026-12" }, prisma);
    expect(dec.categories.find((c) => c.category === "Shopping")?.budgeted).toBe(2000);
    await expect(getBudgetStatus(USER, { month: "2026-13" }, prisma)).rejects.toThrow(/Invalid month/);
    await expect(getBudgetStatus(USER, { month: "2026-10", accountId: other.pfId }, prisma)).rejects.toThrow(/not found/);
  });

  it("matches the app's overview and counts card purchases on their statement, not the bill payment", async () => {
    const { statementId } = await importCardStatement(
      USER,
      {
        accountId: f.card,
        month: "2026-10",
        rows: [
          { date: "2026-09-20", description: "Loja", amount: 300, categoryId: f.categories.Shopping },
          { date: "2026-01-15", description: "TV", amount: 100, categoryId: f.categories.Shopping, installment: { number: 10, total: 12 } },
        ],
      },
      prisma
    );
    const payment = (await expense(400, "2026-10-12", f.categories.Shopping)).entryIds[0];
    await markStatementPayment(USER, payment, statementId, prisma);

    const r = await getBudgetStatus(USER, { month: "2026-10" }, prisma);
    expect(r.categories.find((c) => c.category === "Shopping")?.actual).toBe(6400);
    const overview = await monthOverview(USER, 2026, 10, prisma, { entityIds: [f.pfId] });
    expect(overview.budgets.find((b) => b.category === "Shopping")?.committed).toBe(6400);
  });

  it("stores, lists and updates kind, and returns fixed versus variable totals", async () => {
    const listed = await listBudgets(USER, { category: "Shopping", effectiveDate: "2026-10" }, prisma);
    expect(listed[0].kind).toBeNull();
    const changed = await updateBudget(USER, { budgetId: listed[0].id, kind: "fixo" }, prisma);
    expect(changed.kind).toBe("fixo");
    const cleared = await updateBudget(USER, { budgetId: listed[0].id, kind: null }, prisma);
    expect(cleared.kind).toBeNull();
    await updateBudget(USER, { budgetId: listed[0].id, kind: "fixo" }, prisma);
    const composition = await getBudgetComposition(USER, { from: "2026-10", to: "2026-10" }, prisma);
    expect(composition.months[0].fixo.budgeted).toBe(2800);
    expect(composition.months[0].variavel.budgeted).toBe(1500);
  });

  it("an app-created budget and an MCP one for the same month collide", async () => {
    await createBudgetService(USER, { entityId: f.pfId, categoryId: f.categories.Food, amount: 10, effectiveFrom: "2027-01" }, prisma);
    await expect(createBudget(USER, budget({ category: "Food", effectiveFrom: "2027-01-01" }), prisma)).rejects.toThrow(/already starts/);
  });
});

describe("budget edge cases", () => {
  it("lists nothing for a category name the user does not have, and filters by a known one", async () => {
    await createBudget(USER, budget(), prisma);
    await createBudget(USER, budget({ category: "Food", amount: 900 }), prisma);
    expect(await listBudgets(USER, { category: "Nope" }, prisma)).toEqual([]);
    const shopping = await listBudgets(USER, { category: "Shopping" }, prisma);
    expect(shopping.map((b) => [b.category, b.amount])).toEqual([["Shopping", 2800]]);
    expect((await listBudgets(USER, {}, prisma)).map((b) => b.category).sort()).toEqual(["Food", "Shopping"]);
  });

  it("stores the kind the caller names on create: fixo, variavel, null, or nothing", async () => {
    const fixo = await createBudget(USER, budget({ kind: "fixo" }), prisma);
    const variavel = await createBudget(USER, budget({ category: "Food", kind: "variavel" }), prisma);
    expect([fixo.kind, variavel.kind]).toEqual(["fixo", "variavel"]);

    const explicitNull = await createBudget(USER, budget({ category: "Food", effectiveFrom: "2026-12-01", kind: null }), prisma);
    const omitted = await createBudget(USER, budget({ effectiveFrom: "2026-12-01" }), prisma);
    expect(explicitNull.kind).toBeNull();
    expect(omitted.kind).toBeNull();
  });

  it("reports 0% used for a budget of zero, and sorts the categories by how much of the budget is used", async () => {
    await createBudget(USER, budget({ amount: 0 }), prisma);
    await createBudget(USER, budget({ category: "Food", amount: 1000 }), prisma);
    await expense(300, "2026-10-10", f.categories.Food);
    await expense(50, "2026-10-11", f.categories.Shopping);

    const status = await getBudgetStatus(USER, { month: "2026-10" }, prisma);

    const byCategory = new Map(status.categories.map((c) => [c.category, c]));
    expect(byCategory.get("Shopping")).toMatchObject({ budgeted: 0, actual: 50, percentUsed: 0, isOverBudget: true, remaining: -50 });
    expect(byCategory.get("Food")).toMatchObject({ budgeted: 1000, actual: 300, percentUsed: 30, isOverBudget: false, remaining: 700 });
    expect(status.categories.map((c) => c.category)).toEqual(["Food", "Shopping"]);
  });

  it("rejects an impossible month and an account that is not the user's", async () => {
    await expect(getBudgetStatus(USER, { month: "2026-13" }, prisma)).rejects.toThrow(/Invalid month format/);
    await expect(getBudgetStatus(USER, { month: "2026-00" }, prisma)).rejects.toThrow(/Invalid month format/);
    await expect(getBudgetStatus(USER, { month: "2026-10", accountId: other.pfId }, prisma)).rejects.toThrow(/Account not found or access denied/);
    await expect(listBudgets(USER, { accountId: other.pfId }, prisma)).rejects.toThrow(/Account not found or access denied/);
  });
});
