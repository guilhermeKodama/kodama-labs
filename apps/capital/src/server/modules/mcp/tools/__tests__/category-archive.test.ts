import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { createBillExpense } from "@capital/server/modules/credit-cards/services/create-bill-expense";
import { getSummary } from "@capital/server/modules/reports/services/get-summary";
import { createBudget as createWebBudget } from "@capital/server/modules/budgets/services/create-budget";
import { updateBudgetService } from "@capital/server/modules/budgets/services/update-budget";
import { getBudgetDashboard } from "@capital/server/modules/budgets/services/get-budget-dashboard";
import { createRecurring } from "@capital/server/modules/recurring/services/create-recurring";
import { updateRecurring } from "@capital/server/modules/recurring/data/commands/update-recurring";
import { buildExpenseLedger } from "@/lib/utils/expense-ledger";
import type { Transaction } from "@/types";
import {
  updateCategoryTool,
  mergeCategoryTool,
} from "../categories";
import { listCategoriesForMcp as listCategories } from "../metadata";
import { bulkCreateTransactions } from "../bulk-create-transactions";
import { bulkUpdateTransactions } from "../bulk-update-transactions";
import { importCreditCardStatement } from "../credit-card-statements";
import { createBudget, getBudgetStatus } from "../budgets";
import { listTransactions } from "../list-transactions";

const db = prisma;
const USER = "test-user-category-archive-001";
const OTHER = "test-user-category-archive-002";

async function expenseLedger(personalAccountId: string) {
  const rows = await db.transaction.findMany({
    where: { personalAccountId },
    orderBy: { id: "asc" },
  });
  const ledgerRows: Transaction[] = rows.map((row) => ({
    id: row.id,
    entityId: row.personalAccountId ?? "",
    entityType: row.entityType,
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    exchangeRate: row.exchangeRate,
    description: row.description,
    category: row.category,
    date: row.date,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  return buildExpenseLedger(ledgerRows, [], "BRL");
}

async function resetUsers() {
  await db.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await db.user.create({
    data: {
      id: USER,
      email: "category-archive@example.com",
      passwordHash: "hash",
      name: "Archive",
      baseCurrency: "BRL",
    },
  });
  await db.user.create({
    data: {
      id: OTHER,
      email: "category-archive-other@example.com",
      passwordHash: "hash",
      name: "Other",
      baseCurrency: "BRL",
    },
  });
}

describe("category archive", () => {
  let personalAccountId: string;

  beforeEach(async () => {
    await resetUsers();
    personalAccountId = (await db.personalAccount.create({
      data: { userId: USER, defaultCurrency: "BRL" },
    })).id;
  });

  it("hides an archived category from list_categories until includeArchived", async () => {
    const travel = await getSystemCategory(USER, "travel_default", db);
    await updateCategoryTool(USER, { id: travel.id, isArchived: true }, db);

    const hidden = await listCategories(USER, undefined, db);
    expect(hidden.categories.find((category) => category.id === travel.id)).toBeUndefined();

    const shown = await listCategories(USER, undefined, db, true);
    expect(shown.categories.find((category) => category.id === travel.id)?.isArchived).toBe(true);

    const reread = await db.category.findUnique({ where: { id: travel.id } });
    expect(reread?.isArchived).toBe(true);
    expect(reread?.systemKey).toBe("travel_default");
  });

  it("still writes an archived internal target", async () => {
    const creditCardCategory = await getSystemCategory(USER, "credit_card", db);
    await db.category.update({
      where: { id: creditCardCategory.id },
      data: { isArchived: true },
    });
    const card = await db.creditCard.create({
      data: {
        entityType: "personal",
        personalAccountId,
        bankName: "Nubank",
        lastFourDigits: "3308",
        creditLimit: 5000,
        closingDay: 3,
        dueDay: 10,
        currency: "BRL",
      },
    });
    const bill = await db.creditCardBill.create({
      data: {
        creditCardId: card.id,
        closingDate: new Date("2026-06-03T12:00:00.000Z"),
        dueDate: new Date("2026-06-10T12:00:00.000Z"),
        totalAmount: 120,
      },
    });

    const expense = await createBillExpense(USER, {
      billId: bill.id,
      entityType: "personal",
      personalAccountId,
      currency: "BRL",
      date: new Date("2026-06-10T12:00:00.000Z"),
    }, db);
    expect(expense.category).toBe(creditCardCategory.name);

    await expect(
      bulkCreateTransactions(USER, [{
        entityType: "personal",
        type: "expense",
        amount: 10,
        currency: "BRL",
        description: "manual card",
        category: creditCardCategory.name,
        date: "2026-06-11",
        personalAccountId,
      }], false, db)
    ).rejects.toThrow(/archived/);

    const other = await getSystemCategory(USER, "other_system", db);
    await db.category.update({
      where: { id: other.id },
      data: { isArchived: true },
    });
    const imported = await importCreditCardStatement(USER, {
      creditCardId: card.id,
      statement: { month: "2026-06" },
      rows: [{ date: "2026-06-02", description: "cafe", amount: 12 }],
    }, db);
    const purchase = await db.billTransaction.findFirst({
      where: { statementId: imported.statementId },
    });
    expect(purchase?.category).toBe(other.name);
    const stillArchived = await db.category.findUnique({ where: { id: other.id } });
    expect(stillArchived?.isArchived).toBe(true);
  });

  it("rejects a merge into an archived category and allows renaming a non-default archived category", async () => {
    const source = await db.category.create({
      data: { userId: USER, name: "Freelance", type: "income", isDefault: false },
    });
    const target = await db.category.create({
      data: { userId: USER, name: "Consulting", type: "income", isDefault: false, isArchived: true },
    });

    await expect(
      mergeCategoryTool(USER, { fromId: source.id, toId: target.id }, db)
    ).rejects.toThrow(/archived/);

    const renamed = await updateCategoryTool(USER, {
      id: source.id,
      isArchived: true,
      name: "Contract work",
    }, db);
    expect(renamed.name).toBe("Contract work");
    expect(renamed.isArchived).toBe(true);
  });

  it("keeps budget and transaction totals after the category is archived", async () => {
    const groceries = await db.category.create({
      data: { userId: USER, name: "Groceries", type: "expense" },
    });
    await createBudget(USER, {
      accountId: personalAccountId,
      category: "Groceries",
      amount: 800,
      currency: "BRL",
      effectiveFrom: "2026-10-01",
    }, db);
    await db.transaction.create({
      data: {
        entityType: "personal",
        type: "expense",
        amount: 120,
        currency: "BRL",
        exchangeRate: 1,
        description: "market",
        category: "Groceries",
        date: new Date("2026-10-12T12:00:00.000Z"),
        personalAccountId,
      },
    });

    const dashboardInput = { year: 2026, month: 10, timezone: "UTC" } as const;
    const beforeStatus = await getBudgetStatus(USER, { month: "2026-10", accountId: personalAccountId }, db);
    const beforeSummary = await getSummary({ userId: USER }, db);
    const beforeList = await listTransactions(USER, {
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      category: "Groceries",
    }, db);
    const beforeDashboard = await getBudgetDashboard(USER, dashboardInput, db);
    const beforeLedger = await expenseLedger(personalAccountId);

    await db.category.update({
      where: { id: groceries.id },
      data: { isArchived: true },
    });

    const afterStatus = await getBudgetStatus(USER, { month: "2026-10", accountId: personalAccountId }, db);
    const afterSummary = await getSummary({ userId: USER }, db);
    const afterList = await listTransactions(USER, {
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      category: "Groceries",
    }, db);
    const afterDashboard = await getBudgetDashboard(USER, dashboardInput, db);
    const afterLedger = await expenseLedger(personalAccountId);

    expect(afterStatus).toEqual(beforeStatus);
    expect(afterStatus.categories.find((row) => row.category === "Groceries")?.budgeted).toBe(800);
    expect(afterStatus.categories.find((row) => row.category === "Groceries")?.actual).toBe(120);
    expect(afterSummary).toEqual(beforeSummary);
    expect(afterList).toEqual(beforeList);
    expect(afterList.transactions.some((row) => row.category === "Groceries")).toBe(true);
    expect(afterDashboard).toEqual(beforeDashboard);
    expect(afterLedger).toEqual(beforeLedger);
    expect(afterLedger.filter((row) => row.category === "Groceries").reduce((sum, row) => sum + row.amount, 0)).toBe(120);
  });

  it("allows an update that keeps an archived category and rejects a new one", async () => {
    await db.category.create({
      data: { userId: USER, name: "Groceries", type: "expense", isArchived: true },
    });
    await db.category.create({
      data: { userId: USER, name: "Shopping", type: "expense" },
    });
    const transaction = await db.transaction.create({
      data: {
        entityType: "personal",
        type: "expense",
        amount: 40,
        currency: "BRL",
        exchangeRate: 1,
        description: "market",
        category: "Groceries",
        date: new Date("2026-10-12T12:00:00.000Z"),
        personalAccountId,
      },
    });

    const kept = await bulkUpdateTransactions(USER, [{
      id: transaction.id,
      description: "market run",
      category: "Groceries",
    }], false, db);
    expect(kept.updated).toHaveLength(1);

    await expect(
      bulkUpdateTransactions(USER, [{
        id: transaction.id,
        category: "Groceries",
      }], false, db)
    ).resolves.toBeTruthy();

    await db.category.updateMany({
      where: { userId: USER, name: "Shopping" },
      data: { isArchived: true },
    });
    await expect(
      bulkUpdateTransactions(USER, [{
        id: transaction.id,
        category: "Shopping",
      }], false, db)
    ).rejects.toThrow(/archived/);
  });

  it("does not let another user archive the category", async () => {
    const travel = await getSystemCategory(USER, "marketing", db);
    await expect(
      updateCategoryTool(OTHER, { id: travel.id, isArchived: true }, db)
    ).rejects.toThrow(/access denied|not found/i);
  });

  it("rejects a web budget and recurring write on an archived category", async () => {
    await db.category.create({
      data: { userId: USER, name: "Travel", type: "expense", isArchived: true },
    });
    await db.category.create({
      data: { userId: USER, name: "Shopping", type: "expense", isArchived: true },
    });
    const groceries = await db.category.create({
      data: { userId: USER, name: "Groceries", type: "expense" },
    });

    await expect(createWebBudget(USER, {
      entityType: "personal",
      personalAccountId,
      category: "Travel",
      amount: 100,
      currency: "BRL",
      period: "monthly",
      year: 2026,
      month: 10,
    }, db)).rejects.toThrow(/archived/);

    const budget = await createWebBudget(USER, {
      entityType: "personal",
      personalAccountId,
      category: "Groceries",
      amount: 80,
      currency: "BRL",
      period: "monthly",
      year: 2026,
      month: 10,
    }, db);
    const recurring = await createRecurring(USER, {
      entityType: "personal",
      personalAccountId,
      type: "expense",
      amount: 40,
      currency: "BRL",
      description: "market",
      category: "Groceries",
      frequency: "monthly",
      startDate: new Date("2026-10-01T12:00:00.000Z"),
    }, db);
    await db.category.update({
      where: { id: groceries.id },
      data: { isArchived: true },
    });
    const keptBudget = await updateBudgetService(USER, budget.id, { category: "Groceries" }, db);
    expect(keptBudget.category).toBe("Groceries");
    await expect(
      updateBudgetService(USER, budget.id, { category: "Shopping" }, db)
    ).rejects.toThrow(/archived/);

    await expect(createRecurring(USER, {
      entityType: "personal",
      personalAccountId,
      type: "expense",
      amount: 40,
      currency: "BRL",
      description: "fare",
      category: "Travel",
      frequency: "monthly",
      startDate: new Date("2026-10-01T12:00:00.000Z"),
    }, db)).rejects.toThrow(/archived/);

    const keptRecurring = await updateRecurring(USER, recurring.id, { category: "Groceries" }, db);
    expect(keptRecurring.category).toBe("Groceries");
    await expect(
      updateRecurring(USER, recurring.id, { category: "Shopping" }, db)
    ).rejects.toThrow(/archived/);
  });

  it("rejects a new budget on an archived category", async () => {
    await db.category.create({
      data: { userId: USER, name: "Travel", type: "expense", isArchived: true },
    });
    await expect(
      createBudget(USER, {
        accountId: personalAccountId,
        category: "Travel",
        amount: 100,
        currency: "BRL",
        effectiveFrom: "2026-10-01",
      }, db)
    ).rejects.toThrow(/archived/);
  });
});
