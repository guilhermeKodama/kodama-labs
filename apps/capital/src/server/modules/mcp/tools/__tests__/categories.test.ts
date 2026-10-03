import { describe, it, expect, beforeEach } from "vitest";
import {
  createCategoryTool,
  updateCategoryTool,
  deleteCategoryTool,
  mergeCategoryTool,
} from "../categories";
import { prisma } from "@capital/server/lib/prisma";

const db = prisma;

const TEST_USER_ID = "test-user-mcp-categories-001";

describe("MCP category CRUD tools", () => {
  let personalAccountId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({
      where: {
        OR: [
          { business: { userId: TEST_USER_ID } },
          { personalAccount: { userId: TEST_USER_ID } },
        ],
      },
    });
    await db.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.category.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.user.deleteMany({ where: { id: TEST_USER_ID } });

    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "mcp-categories-test@example.com",
        passwordHash: "test-hash",
        name: "MCP Categories Test User",
        baseCurrency: "BRL",
      },
    });

    const personalAccount = await db.personalAccount.create({
      data: {
        userId: TEST_USER_ID,
        defaultCurrency: "BRL",
      },
    });
    personalAccountId = personalAccount.id;

    // Create system expense categories with systemKeys
    await db.category.createMany({
      data: [
        {
          userId: TEST_USER_ID,
          name: "Credit Card",
          type: "expense",
          isDefault: true,
          isSystem: true,
          systemKey: "credit_card",
        },
        {
          userId: TEST_USER_ID,
          name: "Groceries",
          type: "expense",
          isDefault: true,
          isSystem: true,
          systemKey: "groceries",
        },
      ],
    });

    // Create default income category
    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Salary",
        type: "income",
        isDefault: true,
        systemKey: "salary",
      },
    });
  });

  describe("create_category", () => {
    it("should create a new category", async () => {
      const result = await createCategoryTool(
        TEST_USER_ID,
        {
          name: "Utilities",
          type: "expense",
          color: "#FF5733",
          icon: "⚡",
        },
        db
      );

      expect(result.id).toBeDefined();
      expect(result.name).toBe("Utilities");
      expect(result.type).toBe("expense");
      expect(result.color).toBe("#FF5733");
      expect(result.icon).toBe("⚡");
    });

    it("should create categories of different types", async () => {
      const income = await createCategoryTool(
        TEST_USER_ID,
        { name: "Freelance", type: "income" },
        db
      );
      const expense = await createCategoryTool(
        TEST_USER_ID,
        { name: "Travel", type: "expense" },
        db
      );
      const investment = await createCategoryTool(
        TEST_USER_ID,
        { name: "Crypto", type: "investment" },
        db
      );

      expect(income.type).toBe("income");
      expect(expense.type).toBe("expense");
      expect(investment.type).toBe("investment");
    });
  });

  describe("update_category", () => {
    it("should update category name and color", async () => {
      const category = await createCategoryTool(
        TEST_USER_ID,
        { name: "Food", type: "expense" },
        db
      );

      const updated = await updateCategoryTool(
        TEST_USER_ID,
        {
          id: category.id,
          name: "Food & Dining",
          color: "#FFA500",
        },
        db
      );

      expect(updated.name).toBe("Food & Dining");
      expect(updated.color).toBe("#FFA500");
    });

    it("should update system categories", async () => {
      const categories = await db.category.findMany({
        where: { userId: TEST_USER_ID, isSystem: true },
      });
      const systemCategory = categories[0];

      const updated = await updateCategoryTool(
        TEST_USER_ID,
        {
          id: systemCategory.id,
          name: "Supermarket",
        },
        db
      );

      expect(updated.name).toBe("Supermarket");
    });

    it("should rename a default category and cascade the new name onto its transactions", async () => {
      const categories = await db.category.findMany({
        where: { userId: TEST_USER_ID, isDefault: true },
      });
      const defaultCategory = categories[0];
      const originalName = defaultCategory.name;

      // Create a transaction using this category
      await db.transaction.create({
        data: {
          entityType: "personal",
          type: defaultCategory.type,
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Test transaction",
          category: defaultCategory.name,
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      // Rename to Portuguese
      const updated = await updateCategoryTool(
        TEST_USER_ID,
        {
          id: defaultCategory.id,
          name: "Salário", // Portuguese for Salary
        },
        db
      );

      expect(updated.name).toBe("Salário");

      // Verify transaction was updated
      const transaction = await db.transaction.findFirst({
        where: { personalAccountId },
      });
      expect(transaction?.category).toBe("Salário");

      // Verify old category doesn't exist
      const oldCategory = await db.category.findFirst({
        where: {
          userId: TEST_USER_ID,
          name: originalName,
        },
      });
      // Should still exist but with new name
      expect(oldCategory).toBeNull();

      // Verify the renamed category still exists
      const renamedCategory = await db.category.findFirst({
        where: {
          userId: TEST_USER_ID,
          name: "Salário",
        },
      });
      expect(renamedCategory).not.toBeNull();
      expect(renamedCategory?.isDefault).toBe(true);
    });

    it("renames a statement purchase and a legacy bill line together", async () => {
      const card = await db.creditCard.create({
        data: {
          entityType: "personal",
          personalAccountId,
          bankName: "Nubank",
          lastFourDigits: "9090",
          creditLimit: 1000,
          closingDay: 28,
          dueDay: 5,
          currency: "BRL",
        },
      });
      const bill = await db.creditCardBill.create({
        data: {
          creditCardId: card.id,
          closingDate: new Date("2026-09-28T12:00:00.000Z"),
          dueDate: new Date("2026-10-05T12:00:00.000Z"),
          totalAmount: 10,
        },
      });
      const statement = await db.creditCardStatement.create({
        data: {
          creditCardId: card.id,
          month: "2026-10",
          closingDate: new Date("2026-10-28T12:00:00.000Z"),
        },
      });
      const groceries = await db.category.findFirstOrThrow({
        where: { userId: TEST_USER_ID, systemKey: "groceries" },
      });
      await db.billTransaction.create({
        data: {
          billId: bill.id,
          category: groceries.name,
          transactionDate: new Date("2026-09-10T12:00:00.000Z"),
          description: "Market bill",
          amount: 10,
          currency: "BRL",
        },
      });
      await db.billTransaction.create({
        data: {
          statementId: statement.id,
          category: groceries.name,
          transactionDate: new Date("2026-01-15T12:00:00.000Z"),
          description: "Market statement",
          amount: 12,
          currency: "BRL",
        },
      });

      await updateCategoryTool(TEST_USER_ID, { id: groceries.id, name: "Mercado" }, db);

      const rows = await db.billTransaction.findMany({
        where: { OR: [{ billId: bill.id }, { statementId: statement.id }] },
      });
      expect(rows.map((row) => row.category).sort()).toEqual(["Mercado", "Mercado"]);
    });

    it("should throw error for non-existent category", async () => {
      await expect(
        updateCategoryTool(
          TEST_USER_ID,
          {
            id: "00000000-0000-0000-0000-000000000000",
            name: "New Name",
          },
          db
        )
      ).rejects.toThrow("Category not found");
    });
  });

  describe("delete_category", () => {
    it("should delete category with no linked transactions", async () => {
      const category = await createCategoryTool(
        TEST_USER_ID,
        { name: "Unused", type: "expense" },
        db
      );

      await deleteCategoryTool(TEST_USER_ID, { id: category.id }, db);

      const deleted = await db.category.findUnique({
        where: { id: category.id },
      });
      expect(deleted).toBeNull();
    });

    it("should fail to delete category with transactions without reassignTo", async () => {
      const category = await createCategoryTool(
        TEST_USER_ID,
        { name: "Used", type: "expense" },
        db
      );

      await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Test transaction",
          category: category.name,
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: category.id }, db)
      ).rejects.toThrow(/Cannot delete category with linked records/);
    });

    it("should reassign transactions when deleting category", async () => {
      const oldCategory = await createCategoryTool(
        TEST_USER_ID,
        { name: "Old", type: "expense" },
        db
      );
      const newCategory = await createCategoryTool(
        TEST_USER_ID,
        { name: "New", type: "expense" },
        db
      );

      const transaction = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Test transaction",
          category: oldCategory.name,
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      await deleteCategoryTool(
        TEST_USER_ID,
        { id: oldCategory.id, reassignTo: newCategory.id },
        db
      );

      const updated = await db.transaction.findUnique({
        where: { id: transaction.id },
      });
      expect(updated?.category).toBe(newCategory.name);

      const deleted = await db.category.findUnique({
        where: { id: oldCategory.id },
      });
      expect(deleted).toBeNull();
    });

    it("should not delete system categories (legacy check)", async () => {
      // This test now checks for systemKey instead of isSystem/isDefault
      const systemCategory = await db.category.findFirst({
        where: { userId: TEST_USER_ID, systemKey: "credit_card" },
      });

      expect(systemCategory).not.toBeNull();

      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: systemCategory!.id }, db)
      ).rejects.toThrow(/Cannot delete system category.*systemKey: credit_card/);
    });

    it("should not delete default categories (legacy check)", async () => {
      // This test now checks for systemKey instead of isSystem/isDefault
      const defaultCategory = await db.category.findFirst({
        where: { userId: TEST_USER_ID, systemKey: "salary" },
      });

      expect(defaultCategory).not.toBeNull();

      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: defaultCategory!.id }, db)
      ).rejects.toThrow(/Cannot delete system category.*systemKey: salary/);
    });
  });

  describe("merge_categories", () => {
    it("should merge two categories and move transactions", async () => {
      const category1 = await createCategoryTool(
        TEST_USER_ID,
        { name: "Old Cat", type: "expense" },
        db
      );
      const category2 = await createCategoryTool(
        TEST_USER_ID,
        { name: "New Cat", type: "expense" },
        db
      );

      await db.transaction.createMany({
        data: [
          {
            entityType: "personal",
            type: "expense",
            amount: 100,
            currency: "BRL",
            exchangeRate: 1,
            description: "Transaction 1",
            category: category1.name,
            date: new Date("2026-09-15"),
            personalAccountId,
          },
          {
            entityType: "personal",
            type: "expense",
            amount: 200,
            currency: "BRL",
            exchangeRate: 1,
            description: "Transaction 2",
            category: category1.name,
            date: new Date("2026-09-16"),
            personalAccountId,
          },
        ],
      });

      const result = await mergeCategoryTool(
        TEST_USER_ID,
        { fromId: category1.id, toId: category2.id },
        db
      );

      expect(result.success).toBe(true);
      expect(result.transactionsMoved).toBe(2);
      expect(result.fromCategory).toBe(category1.name);
      expect(result.toCategory).toBe(category2.name);

      const transactions = await db.transaction.findMany({
        where: { category: category2.name },
      });
      expect(transactions).toHaveLength(2);

      const deleted = await db.category.findUnique({
        where: { id: category1.id },
      });
      expect(deleted).toBeNull();
    });

    it("should fail to merge categories of different types", async () => {
      const income = await createCategoryTool(
        TEST_USER_ID,
        { name: "Income Cat", type: "income" },
        db
      );
      const expense = await createCategoryTool(
        TEST_USER_ID,
        { name: "Expense Cat", type: "expense" },
        db
      );

      await expect(
        mergeCategoryTool(
          TEST_USER_ID,
          { fromId: income.id, toId: expense.id },
          db
        )
      ).rejects.toThrow("Cannot merge categories of different types");
    });

    it("should prevent deleting system categories with systemKey", async () => {
      const systemCategory = await db.category.findFirst({
        where: { userId: TEST_USER_ID, systemKey: "credit_card" },
      });

      expect(systemCategory).not.toBeNull();

      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: systemCategory!.id }, db)
      ).rejects.toThrow(/Cannot delete system category.*systemKey: credit_card/);
    });

    it("should prevent merging from system categories with systemKey", async () => {
      const systemCategory = await db.category.findFirst({
        where: { userId: TEST_USER_ID, systemKey: "credit_card" },
      });
      const userCategory = await createCategoryTool(
        TEST_USER_ID,
        { name: "User Expense", type: "expense" },
        db
      );

      expect(systemCategory).not.toBeNull();

      await expect(
        mergeCategoryTool(
          TEST_USER_ID,
          { fromId: systemCategory!.id, toId: userCategory.id },
          db
        )
      ).rejects.toThrow(/Cannot merge from system category.*systemKey: credit_card/);
    });
  });

  describe("Portuguese Localization Integration", () => {
    it("should rename Credit Card to Portuguese and create a bill expense with that name", async () => {
      // Get the Credit Card system category
      const creditCardCategory = await db.category.findFirst({
        where: {
          userId: TEST_USER_ID,
          systemKey: "credit_card",
        },
      });

      expect(creditCardCategory).not.toBeNull();
      expect(creditCardCategory!.name).toBe("Credit Card");

      // Rename to Portuguese
      const renamed = await updateCategoryTool(
        TEST_USER_ID,
        {
          id: creditCardCategory!.id,
          name: "Cartão de Crédito",
        },
        db
      );

      expect(renamed.name).toBe("Cartão de Crédito");
      expect(renamed.systemKey).toBe("credit_card");

      // Create a credit card
      const creditCard = await db.creditCard.create({
        data: {
          entityType: "personal",
          bankName: "Test Bank",
          lastFourDigits: "1234",
          creditLimit: 5000,
          closingDay: 15,
          dueDay: 25,
          currency: "BRL",
          color: "#FF5733",
          isActive: true,
          personalAccountId,
        },
      });

      // Create a bill
      const bill = await db.creditCardBill.create({
        data: {
          creditCardId: creditCard.id,
          closingDate: new Date("2026-09-15"),
          dueDate: new Date("2026-09-25"),
          totalAmount: 1500,
          status: "pending",
        },
      });

      // Import the createBillExpense service
      const { createBillExpense } = await import(
        "@capital/server/modules/credit-cards/services/create-bill-expense"
      );

      // Create bill expense - should use Portuguese category name
      const billExpense = await createBillExpense(
        TEST_USER_ID,
        {
          billId: bill.id,
          entityType: "personal",
          personalAccountId,
          currency: "BRL",
          exchangeRate: 1,
          date: new Date("2026-09-25"),
        },
        db
      );

      // Verify the transaction has the Portuguese category name
      expect(billExpense.category).toBe("Cartão de Crédito");

      // Verify it appears in a query for "Cartão de Crédito" transactions
      const expenseTransactions = await db.transaction.findMany({
        where: {
          personalAccountId,
          type: "expense",
          category: "Cartão de Crédito",
        },
      });

      expect(expenseTransactions).toHaveLength(1);
      expect(expenseTransactions[0].id).toBe(billExpense.id);

      // Verify old English name doesn't exist
      const englishCategoryTransactions = await db.transaction.findMany({
        where: {
          personalAccountId,
          category: "Credit Card",
        },
      });

      expect(englishCategoryTransactions).toHaveLength(0);

      // Verify the category still exists with the new name and systemKey
      const updatedCategory = await db.category.findFirst({
        where: {
          userId: TEST_USER_ID,
          systemKey: "credit_card",
        },
      });

      expect(updatedCategory).not.toBeNull();
      expect(updatedCategory!.name).toBe("Cartão de Crédito");
      expect(updatedCategory!.systemKey).toBe("credit_card");
    });
  });

  describe("guards", () => {
    it("should reject reassigning a category to itself", async () => {
      const category = await createCategoryTool(
        TEST_USER_ID,
        { name: "Temp", type: "expense" },
        db
      );
      await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 10,
          currency: "BRL",
          exchangeRate: 1,
          description: "keep me",
          category: "Temp",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: category.id, reassignTo: category.id }, db)
      ).rejects.toThrow("Cannot reassign a category to itself");

      const still = await db.category.findUnique({ where: { id: category.id } });
      expect(still).not.toBeNull();
      const tx = await db.transaction.findFirst({ where: { personalAccountId, description: "keep me" } });
      expect(tx?.category).toBe("Temp");
    });

    it("should reject merging a category into itself", async () => {
      const category = await createCategoryTool(
        TEST_USER_ID,
        { name: "Solo", type: "expense" },
        db
      );
      await expect(
        mergeCategoryTool(TEST_USER_ID, { fromId: category.id, toId: category.id }, db)
      ).rejects.toThrow("Cannot merge a category into itself");
      const still = await db.category.findUnique({ where: { id: category.id } });
      expect(still).not.toBeNull();
    });

    it("should reject changing the type of a systemKey category", async () => {
      const creditCard = await db.category.findFirst({
        where: { userId: TEST_USER_ID, systemKey: "credit_card" },
      });
      await expect(
        updateCategoryTool(TEST_USER_ID, { id: creditCard!.id, type: "income" }, db)
      ).rejects.toThrow(/Cannot change type of system category/);
      const row = await db.category.findUnique({ where: { id: creditCard!.id } });
      expect(row?.type).toBe("expense");
    });

    it("should not delete an isDefault category that has no systemKey", async () => {
      const category = await db.category.create({
        data: {
          userId: TEST_USER_ID,
          name: "Legacy Default",
          type: "expense",
          isDefault: true,
          isSystem: false,
          systemKey: null,
        },
      });
      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: category.id }, db)
      ).rejects.toThrow("Cannot delete default categories");
    });

    it("should not merge from an isDefault category that has no systemKey", async () => {
      const source = await db.category.create({
        data: {
          userId: TEST_USER_ID,
          name: "Legacy Default Merge",
          type: "expense",
          isDefault: true,
          systemKey: null,
        },
      });
      const target = await createCategoryTool(
        TEST_USER_ID,
        { name: "Plain Expense", type: "expense" },
        db
      );
      await expect(
        mergeCategoryTool(TEST_USER_ID, { fromId: source.id, toId: target.id }, db)
      ).rejects.toThrow("Cannot merge from a default category");
    });

    it("should not relabel a same-named category of the other type", async () => {
      const expense = await createCategoryTool(
        TEST_USER_ID,
        { name: "Shared", type: "expense" },
        db
      );
      await createCategoryTool(TEST_USER_ID, { name: "Shared", type: "income" }, db);
      await db.transaction.create({
        data: {
          entityType: "personal",
          type: "income",
          amount: 20,
          currency: "BRL",
          exchangeRate: 1,
          description: "income shared",
          category: "Shared",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });
      await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 20,
          currency: "BRL",
          exchangeRate: 1,
          description: "expense shared",
          category: "Shared",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      await updateCategoryTool(TEST_USER_ID, { id: expense.id, name: "Shared Expense" }, db);

      const income = await db.transaction.findFirst({
        where: { personalAccountId, description: "income shared" },
      });
      const expenseTx = await db.transaction.findFirst({
        where: { personalAccountId, description: "expense shared" },
      });
      expect(income?.category).toBe("Shared");
      expect(expenseTx?.category).toBe("Shared Expense");
    });

    it("should reject a budget collision on account and effectiveFrom inside the merge", async () => {
      const from = await createCategoryTool(
        TEST_USER_ID,
        { name: "From Budget", type: "expense" },
        db
      );
      const to = await createCategoryTool(
        TEST_USER_ID,
        { name: "To Budget", type: "expense" },
        db
      );
      const effectiveFrom = new Date("2026-10-01T12:00:00.000Z");
      await db.budget.create({
        data: {
          entityType: "personal",
          category: "From Budget",
          amount: 100,
          currency: "BRL",
          period: "monthly",
          year: 2026,
          month: 10,
          effectiveFrom,
          personalAccountId,
        },
      });
      await db.budget.create({
        data: {
          entityType: "personal",
          category: "To Budget",
          amount: 200,
          currency: "BRL",
          period: "monthly",
          year: 2026,
          month: 10,
          effectiveFrom,
          personalAccountId,
        },
      });

      await expect(
        mergeCategoryTool(TEST_USER_ID, { fromId: from.id, toId: to.id }, db)
      ).rejects.toThrow(/Cannot reassign budgets/);

      const fromBudget = await db.budget.findFirst({
        where: { personalAccountId, category: "From Budget" },
      });
      const toBudget = await db.budget.findFirst({
        where: { personalAccountId, category: "To Budget" },
      });
      expect(fromBudget).not.toBeNull();
      expect(toBudget).not.toBeNull();
    });
  });
});
