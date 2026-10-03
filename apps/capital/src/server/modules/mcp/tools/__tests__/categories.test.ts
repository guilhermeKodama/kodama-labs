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

    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Groceries",
        type: "expense",
        isSystem: true,
      },
    });

    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Salary",
        type: "income",
        isDefault: true,
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

    it("should update default categories for localization", async () => {
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

    it("should not delete system categories", async () => {
      const categories = await db.category.findMany({
        where: { userId: TEST_USER_ID, isSystem: true },
      });
      const systemCategory = categories[0];

      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: systemCategory.id }, db)
      ).rejects.toThrow("Cannot delete system categories");
    });

    it("should not delete default categories", async () => {
      const categories = await db.category.findMany({
        where: { userId: TEST_USER_ID, isDefault: true },
      });
      const defaultCategory = categories[0];

      await expect(
        deleteCategoryTool(TEST_USER_ID, { id: defaultCategory.id }, db)
      ).rejects.toThrow("Cannot delete default categories");
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
  });
});
