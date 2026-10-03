import { describe, it, expect, beforeEach } from "vitest";
import {
  listBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetStatus,
} from "../budgets";
import { prisma } from "@capital/server/lib/prisma";

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
      ).rejects.toThrow("already exists");
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
      expect(result.budgetCurrency).toBe("BRL");

      // Summary
      // Total budget: 2,800 (Shopping) + 1,500 (Food) = 4,300 BRL
      // Total actual: (1000+200)*5.5 + 100*5.5 = 1,100 + 550 = 6,600 + 550 = 7,150 BRL... wait that's wrong
      // Let me recalculate: Shopping: 1000*5.5 + 200*5.5 = 5,500 + 1,100 = 6,600 BRL
      // Food: 100*5.5 = 550 BRL
      // Total: 6,600 + 550 = 7,150 BRL
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
  });
});
