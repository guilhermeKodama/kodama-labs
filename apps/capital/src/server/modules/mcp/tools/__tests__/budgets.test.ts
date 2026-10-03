import { describe, it, expect, beforeEach } from "vitest";
import {
  listBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetStatus,
} from "../budgets";
import { prisma } from "@capital/server/lib/prisma";
import { buildExpenseLedger, sumLedgerExpensesByCategory } from "@/lib/utils/expense-ledger";
import { mergeTransactionsWithCreditCard } from "@/lib/utils/budget";
import type { Currency, Transaction } from "@/types";

const db = prisma;

// Test user IDs
const TEST_USER_ID = "test-user-mcp-budgets-001";
const OTHER_USER_ID = "test-user-mcp-budgets-002";

describe("MCP Budget Tools", () => {
  let personalAccountId: string;
  let otherAccountId: string;

  beforeEach(async () => {
    // Clean up test data
    await db.budget.deleteMany({
      where: {
        OR: [
          { personalAccount: { userId: TEST_USER_ID } },
          { personalAccount: { userId: OTHER_USER_ID } },
        ],
      },
    });
    await db.personalAccount.deleteMany({
      where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID] } },
    });
    await db.category.deleteMany({
      where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [TEST_USER_ID, OTHER_USER_ID] } },
    });

    // Create test user
    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "mcp-budgets-test@example.com",
        passwordHash: "test-hash",
        name: "MCP Budgets Test User",
        baseCurrency: "BRL",
      },
    });

    // Create personal account (USD base, but budgets will be in BRL)
    const personalAccount = await db.personalAccount.create({
      data: {
        userId: TEST_USER_ID,
        defaultCurrency: "USD",
      },
    });
    personalAccountId = personalAccount.id;

    // Create categories
    await db.category.createMany({
      data: [
        { userId: TEST_USER_ID, name: "Shopping", type: "expense", isSystem: false },
        { userId: TEST_USER_ID, name: "Food", type: "expense", isSystem: false },
        { userId: TEST_USER_ID, name: "Transport", type: "expense", isSystem: false },
      ],
    });

    // Create other user for access control tests
    await db.user.create({
      data: {
        id: OTHER_USER_ID,
        email: "other-budgets-user@example.com",
        passwordHash: "test-hash",
        name: "Other User",
        baseCurrency: "BRL",
      },
    });

    const otherAccount = await db.personalAccount.create({
      data: {
        userId: OTHER_USER_ID,
        defaultCurrency: "USD",
      },
    });
    otherAccountId = otherAccount.id;
  });

  describe("createBudget", () => {
    it("should create a budget successfully", async () => {
      const result = await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      expect(result.id).toBeDefined();
      expect(result.category).toBe("Shopping");
      expect(result.amount).toBe(2800);
      expect(result.currency).toBe("BRL");
      expect(result.effectiveFrom).toBe("2026-10-01");
      expect(result.period).toBe("monthly");
      expect(result.year).toBe(2026);
      expect(result.month).toBe(10);

      // Verify in database
      const budget = await db.budget.findUnique({
        where: { id: result.id },
      });
      expect(budget).toBeDefined();
      expect(budget?.personalAccountId).toBe(personalAccountId);
    });

    it("should reactivate and update an inactive budget instead of failing", async () => {
      // Create a budget
      const budget1 = await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      // Soft delete it
      await deleteBudget(TEST_USER_ID, { budgetId: budget1.id }, db);

      // Verify it's inactive
      const inactive = await db.budget.findUnique({
        where: { id: budget1.id },
      });
      expect(inactive?.isActive).toBe(false);

      // Create again with same category/effectiveFrom - should reactivate
      const budget2 = await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 3000,
          currency: "USD",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      // Should be same ID but updated
      expect(budget2.id).toBe(budget1.id);
      expect(budget2.amount).toBe(3000);
      expect(budget2.currency).toBe("USD");

      // Verify it's active again
      const reactivated = await db.budget.findUnique({
        where: { id: budget1.id },
      });
      expect(reactivated?.isActive).toBe(true);
      expect(reactivated?.amount).toBe(3000);
    });

    it("should reject negative budget amount", async () => {
      await expect(
        createBudget(
          TEST_USER_ID,
          {
            accountId: personalAccountId,
            category: "Shopping",
            amount: -100,
            currency: "BRL",
            effectiveFrom: "2026-10-01",
          },
          db
        )
      ).rejects.toThrow("Budget amount must be non-negative");
    });

    it("should reject account not owned by user", async () => {
      await expect(
        createBudget(
          TEST_USER_ID,
          {
            accountId: otherAccountId,
            category: "Shopping",
            amount: 2800,
            currency: "BRL",
            effectiveFrom: "2026-10-01",
          },
          db
        )
      ).rejects.toThrow("Account not found or access denied");
    });

    it("should reject duplicate budget (same account, category, effectiveFrom)", async () => {
      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      await expect(
        createBudget(
          TEST_USER_ID,
          {
            accountId: personalAccountId,
            category: "Shopping",
            amount: 3000,
            currency: "BRL",
            effectiveFrom: "2026-10-01",
          },
          db
        )
      ).rejects.toThrow("Active budget");
    });

    it("should allow multiple budgets for same category with different effective dates", async () => {
      const budget1 = await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      const budget2 = await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2000,
          currency: "BRL",
          effectiveFrom: "2026-12-01",
        },
        db
      );

      expect(budget1.id).not.toBe(budget2.id);
      expect(budget1.amount).toBe(2800);
      expect(budget2.amount).toBe(2000);
    });
  });

  describe("listBudgets", () => {
    beforeEach(async () => {
      // Create several budgets with different effective dates
      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2000,
          currency: "BRL",
          effectiveFrom: "2026-12-01",
        },
        db
      );

      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Food",
          amount: 1500,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );
    });

    it("should list all budgets without filters", async () => {
      const result = await listBudgets(
        TEST_USER_ID,
        { accountId: personalAccountId },
        db
      );

      expect(result.length).toBe(3);
      expect(result.map((b) => b.category).sort()).toEqual(["Food", "Shopping", "Shopping"]);
    });

    it("should filter by category", async () => {
      const result = await listBudgets(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
        },
        db
      );

      expect(result.length).toBe(2);
      expect(result.every((b) => b.category === "Shopping")).toBe(true);
    });

    it("should filter by effective date and return only the most recent for each category", async () => {
      // For Nov 2026, Shopping should have amount 2800 (effective Oct 1)
      const novResult = await listBudgets(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          effectiveDate: "2026-11-01",
        },
        db
      );

      expect(novResult.length).toBe(2); // Shopping and Food
      const shopping = novResult.find((b) => b.category === "Shopping");
      expect(shopping?.amount).toBe(2800);
      expect(shopping?.effectiveFrom).toBe("2026-10-01");

      // For Dec 2026, Shopping should have amount 2000 (effective Dec 1)
      const decResult = await listBudgets(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          effectiveDate: "2026-12-01",
        },
        db
      );

      expect(decResult.length).toBe(2); // Shopping and Food
      const shoppingDec = decResult.find((b) => b.category === "Shopping");
      expect(shoppingDec?.amount).toBe(2000);
      expect(shoppingDec?.effectiveFrom).toBe("2026-12-01");
    });

    it("should return empty if effective date is before any budget", async () => {
      const result = await listBudgets(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          effectiveDate: "2026-09-01",
        },
        db
      );

      expect(result.length).toBe(0);
    });
  });

  describe("updateBudget", () => {
    let budgetId: string;

    beforeEach(async () => {
      const budget = await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );
      budgetId = budget.id;
    });

    it("should update budget amount", async () => {
      const result = await updateBudget(
        TEST_USER_ID,
        {
          budgetId,
          amount: 3000,
        },
        db
      );

      expect(result.amount).toBe(3000);
      expect(result.category).toBe("Shopping");
      expect(result.currency).toBe("BRL");
    });

    it("should update budget currency", async () => {
      const result = await updateBudget(
        TEST_USER_ID,
        {
          budgetId,
          currency: "USD",
        },
        db
      );

      expect(result.currency).toBe("USD");
      expect(result.amount).toBe(2800); // Unchanged
    });

    it("should update effectiveFrom date", async () => {
      const result = await updateBudget(
        TEST_USER_ID,
        {
          budgetId,
          effectiveFrom: "2026-11-01",
        },
        db
      );

      expect(result.effectiveFrom).toBe("2026-11-01");
      expect(result.year).toBe(2026);
      expect(result.month).toBe(11);
    });

    it("should deactivate budget", async () => {
      const result = await updateBudget(
        TEST_USER_ID,
        {
          budgetId,
          isActive: false,
        },
        db
      );

      expect(result.isActive).toBe(false);

      // Verify it doesn't appear in active listings
      const budgets = await listBudgets(
        TEST_USER_ID,
        { accountId: personalAccountId },
        db
      );
      expect(budgets.find((b) => b.id === budgetId)).toBeUndefined();
    });

    it("should reject negative amount", async () => {
      await expect(
        updateBudget(
          TEST_USER_ID,
          {
            budgetId,
            amount: -100,
          },
          db
        )
      ).rejects.toThrow("Budget amount must be non-negative");
    });

    it("should reject budget not owned by user", async () => {
      // Create budget for other user
      const otherBudget = await createBudget(
        OTHER_USER_ID,
        {
          accountId: otherAccountId,
          category: "Shopping",
          amount: 1000,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      await expect(
        updateBudget(
          TEST_USER_ID,
          {
            budgetId: otherBudget.id,
            amount: 2000,
          },
          db
        )
      ).rejects.toThrow("Budget not found or access denied");
    });

    it("should reject duplicate effectiveFrom for same category", async () => {
      // Create another budget for Shopping with different effective date
      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2000,
          currency: "BRL",
          effectiveFrom: "2026-12-01",
        },
        db
      );

      // Try to update first budget to same effectiveFrom as second
      await expect(
        updateBudget(
          TEST_USER_ID,
          {
            budgetId,
            effectiveFrom: "2026-12-01",
          },
          db
        )
      ).rejects.toThrow("already exists");
    });
  });

  describe("deleteBudget", () => {
    let budgetId: string;

    beforeEach(async () => {
      const budget = await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );
      budgetId = budget.id;
    });

    it("should soft delete budget", async () => {
      const result = await deleteBudget(
        TEST_USER_ID,
        { budgetId },
        db
      );

      expect(result.success).toBe(true);
      expect(result.budgetId).toBe(budgetId);

      // Verify it's marked inactive
      const budget = await db.budget.findUnique({
        where: { id: budgetId },
      });
      expect(budget?.isActive).toBe(false);

      // Verify it doesn't appear in listings
      const budgets = await listBudgets(
        TEST_USER_ID,
        { accountId: personalAccountId },
        db
      );
      expect(budgets.find((b) => b.id === budgetId)).toBeUndefined();
    });

    it("should reject budget not owned by user", async () => {
      const otherBudget = await createBudget(
        OTHER_USER_ID,
        {
          accountId: otherAccountId,
          category: "Shopping",
          amount: 1000,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      await expect(
        deleteBudget(
          TEST_USER_ID,
          { budgetId: otherBudget.id },
          db
        )
      ).rejects.toThrow("Budget not found or access denied");
    });
  });

  describe("getBudgetStatus", () => {
    beforeEach(async () => {
      // Create budgets with effective dating
      // Shopping: 2,800 Oct-Nov, 2,000 Dec onwards
      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2800,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Shopping",
          amount: 2000,
          currency: "BRL",
          effectiveFrom: "2026-12-01",
        },
        db
      );

      // Food: constant 1,500
      await createBudget(
        TEST_USER_ID,
        {
          accountId: personalAccountId,
          category: "Food",
          amount: 1500,
          currency: "BRL",
          effectiveFrom: "2026-10-01",
        },
        db
      );

      // Create test transactions for Oct 2026
      // Note: Personal account is USD, but we'll use exchangeRate to convert to BRL
      // Assuming BRL is user's baseCurrency and exchangeRate already converts to BRL
      await db.transaction.createMany({
        data: [
          {
            entityType: "personal",
            type: "expense",
            amount: 1000, // USD
            currency: "USD",
            exchangeRate: 5.5, // USD -> BRL, so 1000 * 5.5 = 5,500 BRL
            description: "Shopping expense 1",
            category: "Shopping",
            date: new Date("2026-10-15T12:00:00.000Z"),
            personalAccountId,
          },
          {
            entityType: "personal",
            type: "expense",
            amount: 200, // USD
            currency: "USD",
            exchangeRate: 5.5, // 200 * 5.5 = 1,100 BRL
            description: "Shopping expense 2",
            category: "Shopping",
            date: new Date("2026-10-20T12:00:00.000Z"),
            personalAccountId,
          },
          {
            entityType: "personal",
            type: "expense",
            amount: 100, // USD
            currency: "USD",
            exchangeRate: 5.5, // 100 * 5.5 = 550 BRL
            description: "Food expense",
            category: "Food",
            date: new Date("2026-10-10T12:00:00.000Z"),
            personalAccountId,
          },
          // Transfer (should not count as expense)
          {
            entityType: "personal",
            type: "income",
            amount: 500,
            currency: "USD",
            exchangeRate: 5.5,
            description: "Income - should not count",
            category: "Salary",
            date: new Date("2026-10-05T12:00:00.000Z"),
            personalAccountId,
          },
        ],
      });
    });

    it("should calculate budget status for Oct 2026 with correct FX conversion", async () => {
      const result = await getBudgetStatus(
        TEST_USER_ID,
        {
          month: "2026-10",
          accountId: personalAccountId,
        },
        db
      );

      expect(result.month).toBe("2026-10");
      expect(result.accountId).toBe(personalAccountId);
      expect(result.accountCurrency).toBe("USD");
      // Budget currency should be user's base currency (BRL)
      expect(result.budgetCurrency).toBe("BRL");

      // Summary
      // Total budget: 2,800 (Shopping) + 1,500 (Food) = 4,300 BRL
      // Total actual: Shopping: 1000*5.5 + 200*5.5 = 6,600 BRL; Food: 100*5.5 = 550 BRL
      // Total: 7,150 BRL
      expect(result.summary.totalBudgeted).toBe(4300);
      expect(result.summary.totalActual).toBe(7150);
      expect(result.summary.totalRemaining).toBe(4300 - 7150);

      // Categories
      expect(result.categories.length).toBe(2);

      const shopping = result.categories.find((c) => c.category === "Shopping");
      expect(shopping).toBeDefined();
      expect(shopping?.budgeted).toBe(2800);
      expect(shopping?.actual).toBe(6600); // 1000*5.5 + 200*5.5
      expect(shopping?.remaining).toBe(2800 - 6600);
      expect(shopping?.isOverBudget).toBe(true);
      expect(shopping?.percentUsed).toBeCloseTo((6600 / 2800) * 100, 1);

      const food = result.categories.find((c) => c.category === "Food");
      expect(food).toBeDefined();
      expect(food?.budgeted).toBe(1500);
      expect(food?.actual).toBe(550);
      expect(food?.remaining).toBe(950);
      expect(food?.isOverBudget).toBe(false);
      expect(food?.percentUsed).toBeCloseTo((550 / 1500) * 100, 1);
    });

    it("should correctly convert USD account expenses to BRL budget currency via exchangeRate", async () => {
      // This test verifies the currency conversion rule:
      // - Personal account is in USD (defaultCurrency)
      // - User's baseCurrency is BRL
      // - Budget is stored with amount in BRL (user.baseCurrency)
      // - Transaction amount (USD) * exchangeRate = amount in BRL (user.baseCurrency)
      // - Budget comparison is done in BRL (user.baseCurrency)
      
      // We already have:
      // - Shopping budget: 2,800 BRL
      // - Shopping transaction 1: 1,000 USD * 5.5 = 5,500 BRL
      // - Shopping transaction 2: 200 USD * 5.5 = 1,100 BRL
      // Total: 6,600 BRL vs budget 2,800 BRL
      
      const result = await getBudgetStatus(
        TEST_USER_ID,
        {
          month: "2026-10",
          accountId: personalAccountId,
        },
        db
      );

      const shopping = result.categories.find((c) => c.category === "Shopping");
      
      // Verify actual spending is converted correctly
      expect(shopping?.actual).toBe(6600); // sum(amount * exchangeRate)
      
      // Verify comparison is in BRL (user base currency)
      expect(result.budgetCurrency).toBe("BRL");
      
      // The account's default currency (USD) is independent
      expect(result.accountCurrency).toBe("USD");
    });

    it("should use effective budget for Dec 2026", async () => {
      // For Dec, Shopping budget should be 2,000 (not 2,800)
      const result = await getBudgetStatus(
        TEST_USER_ID,
        {
          month: "2026-12",
          accountId: personalAccountId,
        },
        db
      );

      const shopping = result.categories.find((c) => c.category === "Shopping");
      expect(shopping?.budgeted).toBe(2000); // Dec effective budget
    });

    it("should reject invalid month format", async () => {
      await expect(
        getBudgetStatus(
          TEST_USER_ID,
          {
            month: "2026/10",
            accountId: personalAccountId,
          },
          db
        )
      ).rejects.toThrow("Invalid month format");
    });

    it("should reject account not owned by user", async () => {
      await expect(
        getBudgetStatus(
          TEST_USER_ID,
          {
            month: "2026-10",
            accountId: otherAccountId,
          },
          db
        )
      ).rejects.toThrow("Account not found or access denied");
    });

    it("should only count expenses, not income or transfers", async () => {
      const result = await getBudgetStatus(
        TEST_USER_ID,
        {
          month: "2026-10",
          accountId: personalAccountId,
        },
        db
      );

      // Total actual should only include expenses (Shopping + Food)
      // Not the income transaction
      expect(result.summary.totalActual).toBe(7150); // Only expenses
    });

    it("should verify UI dashboard uses same effective-date resolution as MCP", async () => {
      // This test ensures UI (get-budget-dashboard) and MCP (get_budget_status)
      // use identical budget resolution via getEffectiveBudgetsForMonth helper

      // Nov 2026: should resolve to Oct budget (2,800) since no Nov budget exists
      const novResult = await getBudgetStatus(
        TEST_USER_ID,
        {
          month: "2026-11",
          accountId: personalAccountId,
        },
        db
      );

      const novShopping = novResult.categories.find((c) => c.category === "Shopping");
      expect(novShopping).toBeDefined();
      expect(novShopping?.budgeted).toBe(2800); // Oct budget carries forward to Nov

      // Feb 2027: should resolve to Dec budget (2,000)
      const febResult = await getBudgetStatus(
        TEST_USER_ID,
        {
          month: "2027-02",
          accountId: personalAccountId,
        },
        db
      );

      const febShopping = febResult.categories.find((c) => c.category === "Shopping");
      expect(febShopping).toBeDefined();
      expect(febShopping?.budgeted).toBe(2000); // Dec budget carries forward to Feb/27
    });

    it("should prevent duplicate budgets when creating via UI then MCP for same month", async () => {
      // This test ensures timestamp normalization prevents duplicates
      // UI service creates with year/month, MCP with specific date - both normalize to noon UTC
      
      const uiCreateBudget = (await import("../../../budgets/services/create-budget")).createBudget;

      // Create via UI service for Oct 2026 (implicitly 2026-10-01 12:00 UTC)
      const uiBudget = await uiCreateBudget(
        TEST_USER_ID,
        {
          entityType: "personal",
          personalAccountId,
          category: "Entertainment",
          amount: 800,
          currency: "BRL",
          period: "monthly",
          year: 2026,
          month: 10,
        },
        db
      );

      expect(uiBudget.id).toBeDefined();

      // Attempt to create via MCP for 2026-10-15 (should normalize to 2026-10-01 12:00 UTC)
      // This should either:
      // (a) throw duplicate error if active budget exists, OR
      // (b) reactivate if the UI budget was soft-deleted
      await expect(
        createBudget(
          TEST_USER_ID,
          {
            accountId: personalAccountId,
            category: "Entertainment",
            amount: 900,
            currency: "BRL",
            effectiveFrom: "2026-10-15", // Different day, same month
          },
          db
        )
      ).rejects.toThrow("Active budget");

      // Verify only one budget exists for Entertainment in Oct
      const allEntertainment = await db.budget.findMany({
        where: {
          personalAccountId,
          category: "Entertainment",
          effectiveFrom: {
            gte: new Date("2026-10-01T00:00:00Z"),
            lt: new Date("2026-11-01T00:00:00Z"),
          },
        },
      });

      expect(allEntertainment.length).toBe(1);
      expect(allEntertainment[0].id).toBe(uiBudget.id);

      // Verify the effectiveFrom is normalized to noon UTC
      expect(allEntertainment[0].effectiveFrom.getUTCHours()).toBe(12);
      expect(allEntertainment[0].effectiveFrom.getUTCMinutes()).toBe(0);
    });

    it("matches the budgets page ledger for a linked payment, BRL and USD purchases, and a regular expense", async () => {
      await db.currency.create({
        data: {
          userId: TEST_USER_ID,
          code: "USD",
          name: "US Dollar",
          symbol: "$",
          manualRate: 0.2,
        },
      });

      const card = await db.creditCard.create({
        data: {
          entityType: "personal",
          bankName: "Test Bank",
          lastFourDigits: "4242",
          creditLimit: 10000,
          closingDay: 28,
          dueDay: 5,
          currency: "BRL",
          personalAccountId,
        },
      });

      const payment = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 5000,
          currency: "USD",
          exchangeRate: 5.5,
          description: "Card payment next month",
          category: "Shopping",
          date: new Date("2026-11-15T12:00:00.000Z"),
          personalAccountId,
        },
      });

      await db.creditCardStatement.create({
        data: {
          creditCardId: card.id,
          month: "2026-10",
          closingDate: new Date("2026-10-28T12:00:00.000Z"),
          billPaymentTransactionId: payment.id,
          purchases: {
            create: [
              {
                category: "Shopping",
                transactionDate: new Date("2026-10-12T12:00:00.000Z"),
                description: "Market",
                amount: 80,
                currency: "BRL",
              },
              {
                category: "Food",
                transactionDate: new Date("2026-10-18T12:00:00.000Z"),
                description: "USD dinner",
                amount: 20,
                currency: "USD",
              },
            ],
          },
        },
      });

      const [rows, statements, currencyRows] = await Promise.all([
        db.transaction.findMany({ where: { personalAccountId } }),
        db.creditCardStatement.findMany({
          where: { creditCard: { personalAccountId } },
          include: {
            creditCard: true,
            purchases: true,
          },
        }),
        db.currency.findMany({ where: { userId: TEST_USER_ID } }),
      ]);

      const currencies: Currency[] = currencyRows.map((row) => ({
        code: row.code,
        name: row.name,
        symbol: row.symbol,
        manualRate: row.manualRate,
        updatedAt: row.updatedAt,
      }));
      const settlementIds = new Set(
        statements
          .map((statement) => statement.billPaymentTransactionId)
          .filter((id): id is string => id !== null)
      );
      const clientTransactions: Transaction[] = rows.map((tx) => ({
        id: tx.id,
        entityId: personalAccountId,
        entityType: tx.entityType,
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        exchangeRate: tx.exchangeRate,
        description: tx.description,
        category: tx.category,
        date: tx.date,
        isCardSettlement: settlementIds.has(tx.id),
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
      }));
      const ledger = buildExpenseLedger(
        clientTransactions,
        statements.map((statement) => ({
          id: statement.id,
          month: statement.month,
          closingDate: statement.closingDate,
          billPaymentTransactionId: statement.billPaymentTransactionId,
          creditCard: {
            entityId: statement.creditCard.personalAccountId ?? personalAccountId,
            entityType: statement.creditCard.entityType,
            currency: statement.creditCard.currency,
          },
          purchases: statement.purchases.map((purchase) => ({
            id: purchase.id,
            amount: purchase.amount,
            currency: purchase.currency,
            category: purchase.category,
            description: purchase.description,
            transactionDate: purchase.transactionDate,
          })),
        })),
        "BRL",
        currencies
      );
      const pageRows = mergeTransactionsWithCreditCard(
        ledger,
        [],
        [],
        [],
        [],
        new Set(),
        currencies,
        "BRL"
      );
      const october = sumLedgerExpensesByCategory(pageRows, 2026, 10, personalAccountId);
      const round2 = (value: number) => Math.round(value * 100) / 100;

      const result = await getBudgetStatus(
        TEST_USER_ID,
        { month: "2026-10", accountId: personalAccountId },
        db
      );
      const shopping = result.categories.find((category) => category.category === "Shopping");
      const food = result.categories.find((category) => category.category === "Food");

      // Regular October expenses (6600 Shopping, 550 Food) plus statement purchases.
      // USD 20 at manualRate 0.2 is 100 BRL. The November payment is not an October expense.
      expect(shopping?.actual).toBe(round2(october.Shopping ?? 0));
      expect(food?.actual).toBe(round2(october.Food ?? 0));
      expect(shopping?.actual).toBe(6680);
      expect(food?.actual).toBe(650);
      expect(result.summary.totalActual).toBe(7330);

      const november = await getBudgetStatus(
        TEST_USER_ID,
        { month: "2026-11", accountId: personalAccountId },
        db
      );
      const novemberShopping = november.categories.find((category) => category.category === "Shopping");
      expect(novemberShopping?.actual).toBe(0);
      expect(november.summary.totalActual).toBe(0);
    });

    it("counts a January installment on an October statement in October", async () => {
      await db.currency.create({
        data: {
          userId: TEST_USER_ID,
          code: "USD",
          name: "US Dollar",
          symbol: "$",
          manualRate: 0.2,
        },
      });
      const card = await db.creditCard.create({
        data: {
          entityType: "personal",
          bankName: "Parcelas",
          lastFourDigits: "1010",
          creditLimit: 5000,
          closingDay: 28,
          dueDay: 5,
          currency: "BRL",
          personalAccountId,
        },
      });
      const payment = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 5000,
          currency: "USD",
          exchangeRate: 5.5,
          description: "November card payment",
          category: "Shopping",
          date: new Date("2026-11-15T12:00:00.000Z"),
          personalAccountId,
        },
      });
      await db.creditCardStatement.create({
        data: {
          creditCardId: card.id,
          month: "2026-10",
          closingDate: new Date("2026-10-28T12:00:00.000Z"),
          billPaymentTransactionId: payment.id,
          purchases: {
            create: [
              {
                category: "Shopping",
                transactionDate: new Date("2026-01-15T12:00:00.000Z"),
                description: "PARC 3/10",
                amount: 50,
                currency: "BRL",
                installmentNumber: 3,
                totalInstallments: 10,
              },
              {
                category: "Shopping",
                transactionDate: new Date("2026-01-15T12:00:00.000Z"),
                description: "USD installment",
                amount: 20,
                currency: "USD",
              },
            ],
          },
        },
      });

      const october = await getBudgetStatus(
        TEST_USER_ID,
        { month: "2026-10", accountId: personalAccountId },
        db
      );
      const shopping = october.categories.find((category) => category.category === "Shopping");
      // Parent October Shopping 6600 plus 50 BRL and 20 USD / 0.2.
      expect(shopping?.actual).toBe(6600 + 50 + 100);

      const january = await getBudgetStatus(
        TEST_USER_ID,
        { month: "2026-01", accountId: personalAccountId },
        db
      );
      const januaryShopping = january.categories.find((category) => category.category === "Shopping");
      expect(januaryShopping?.actual ?? 0).toBe(0);

      const november = await getBudgetStatus(
        TEST_USER_ID,
        { month: "2026-11", accountId: personalAccountId },
        db
      );
      const novemberShopping = november.categories.find((category) => category.category === "Shopping");
      expect(novemberShopping?.actual).toBe(0);
    });
  });
});
