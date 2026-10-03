import { describe, it, expect, beforeEach } from "vitest";
import { bulkUpdateTransactions } from "../bulk-update-transactions";
import { validateCategory, findOrphanTransactions } from "../../lib/category-validation";
import { prisma } from "@capital/server/lib/prisma";

const db = prisma;

const TEST_USER_ID = "test-user-mcp-bulk-update-001";

describe("MCP bulk update and validation", () => {
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
        email: "mcp-bulk-update-test@example.com",
        passwordHash: "test-hash",
        name: "MCP Bulk Update Test User",
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

    const category = await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Groceries",
        type: "expense",
      },
    });
    // Store category ID for future use if needed
    void category.id;

    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Entertainment",
        type: "expense",
      },
    });

    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Salary",
        type: "income",
      },
    });
  });

  describe("validateCategory", () => {
    it("should validate existing category", async () => {
      const result = await validateCategory(TEST_USER_ID, "Groceries", "expense", db);
      expect(result.valid).toBe(true);
      expect(result.suggestions).toHaveLength(0);
    });

    it("should reject unknown category with suggestions", async () => {
      const result = await validateCategory(TEST_USER_ID, "Grocery", "expense", db);
      expect(result.valid).toBe(false);
      expect(result.suggestions).toContain("Groceries");
    });

    it("should suggest close matches", async () => {
      const result = await validateCategory(TEST_USER_ID, "Enterainment", "expense", db);
      expect(result.valid).toBe(false);
      expect(result.suggestions).toContain("Entertainment");
    });

    it("should handle completely unknown categories", async () => {
      const result = await validateCategory(TEST_USER_ID, "XYZ123", "expense", db);
      expect(result.valid).toBe(false);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("findOrphanTransactions", () => {
    it("should find transactions with non-existent categories", async () => {
      await db.transaction.createMany({
        data: [
          {
            entityType: "personal",
            type: "expense",
            amount: 100,
            currency: "BRL",
            exchangeRate: 1,
            description: "Valid transaction",
            category: "Groceries",
            date: new Date("2026-09-15"),
            personalAccountId,
          },
          {
            entityType: "personal",
            type: "expense",
            amount: 200,
            currency: "BRL",
            exchangeRate: 1,
            description: "Orphan transaction 1",
            category: "House",
            date: new Date("2026-09-16"),
            personalAccountId,
          },
          {
            entityType: "personal",
            type: "expense",
            amount: 300,
            currency: "BRL",
            exchangeRate: 1,
            description: "Orphan transaction 2",
            category: "House",
            date: new Date("2026-09-17"),
            personalAccountId,
          },
          {
            entityType: "personal",
            type: "expense",
            amount: 400,
            currency: "BRL",
            exchangeRate: 1,
            description: "Another orphan",
            category: "Unknown",
            date: new Date("2026-09-18"),
            personalAccountId,
          },
        ],
      });

      const result = await findOrphanTransactions(TEST_USER_ID, db);

      expect(result.total).toBe(3);
      expect(result.categories).toHaveLength(2);
      expect(result.categories.find((c) => c.name === "House")?.count).toBe(2);
      expect(result.categories.find((c) => c.name === "Unknown")?.count).toBe(1);
      expect(result.transactions).toHaveLength(3);
    });

    it("should return empty when all transactions have valid categories", async () => {
      await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Valid transaction",
          category: "Groceries",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      const result = await findOrphanTransactions(TEST_USER_ID, db);

      expect(result.total).toBe(0);
      expect(result.categories).toHaveLength(0);
      expect(result.transactions).toHaveLength(0);
    });
  });

  describe("bulkUpdateTransactions", () => {
    it("should update multiple transactions in a single call", async () => {
      const txn1 = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Transaction 1",
          category: "Groceries",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      const txn2 = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 200,
          currency: "BRL",
          exchangeRate: 1,
          description: "Transaction 2",
          category: "Groceries",
          date: new Date("2026-09-16"),
          personalAccountId,
        },
      });

      const result = await bulkUpdateTransactions(
        TEST_USER_ID,
        [
          {
            id: txn1.id,
            category: "Entertainment",
          },
          {
            id: txn2.id,
            category: "Entertainment",
            amount: 250,
          },
        ],
        false,
        db
      );

      expect(result.updated).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      const updated1 = await db.transaction.findUnique({ where: { id: txn1.id } });
      expect(updated1?.category).toBe("Entertainment");
      expect(updated1?.amount).toBe(100);

      const updated2 = await db.transaction.findUnique({ where: { id: txn2.id } });
      expect(updated2?.category).toBe("Entertainment");
      expect(updated2?.amount).toBe(250);
    });

    it("should work in dry-run mode", async () => {
      const txn = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Transaction",
          category: "Groceries",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      const result = await bulkUpdateTransactions(
        TEST_USER_ID,
        [
          {
            id: txn.id,
            category: "Entertainment",
          },
        ],
        true,
        db
      );

      expect(result.updated).toHaveLength(1);
      expect(result.errors).toHaveLength(0);

      const unchanged = await db.transaction.findUnique({ where: { id: txn.id } });
      expect(unchanged?.category).toBe("Groceries");
    });

    it("should validate categories before updating", async () => {
      const txn = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Transaction",
          category: "Groceries",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      await expect(
        bulkUpdateTransactions(
          TEST_USER_ID,
          [
            {
              id: txn.id,
              category: "InvalidCategory",
            },
          ],
          false,
          db
        )
      ).rejects.toThrow(/Category 'InvalidCategory' not found/);
    });

    it("should fail all-or-nothing if one validation fails", async () => {
      const txn1 = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Transaction 1",
          category: "Groceries",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      const txn2 = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 200,
          currency: "BRL",
          exchangeRate: 1,
          description: "Transaction 2",
          category: "Groceries",
          date: new Date("2026-09-16"),
          personalAccountId,
        },
      });

      await expect(
        bulkUpdateTransactions(
          TEST_USER_ID,
          [
            {
              id: txn1.id,
              category: "Entertainment",
            },
            {
              id: txn2.id,
              category: "InvalidCategory",
            },
          ],
          false,
          db
        )
      ).rejects.toThrow();

      const unchanged1 = await db.transaction.findUnique({ where: { id: txn1.id } });
      expect(unchanged1?.category).toBe("Groceries");
    });

    it("should handle 200 updates efficiently", async () => {
      const transactions = [];
      for (let i = 0; i < 200; i++) {
        const txn = await db.transaction.create({
          data: {
            entityType: "personal",
            type: "expense",
            amount: 100 + i,
            currency: "BRL",
            exchangeRate: 1,
            description: `Transaction ${i}`,
            category: "Groceries",
            date: new Date(`2026-09-${String((i % 30) + 1).padStart(2, "0")}`),
            personalAccountId,
          },
        });
        transactions.push(txn);
      }

      const updates = transactions.map((txn) => ({
        id: txn.id,
        category: "Entertainment",
      }));

      const result = await bulkUpdateTransactions(TEST_USER_ID, updates, false, db);

      expect(result.updated).toHaveLength(200);
      expect(result.errors).toHaveLength(0);

      const updated = await db.transaction.findMany({
        where: { category: "Entertainment" },
      });
      expect(updated).toHaveLength(200);
    });

    it("should update dates with parseLocalDate normalization", async () => {
      const txn = await db.transaction.create({
        data: {
          entityType: "personal",
          type: "expense",
          amount: 100,
          currency: "BRL",
          exchangeRate: 1,
          description: "Transaction",
          category: "Groceries",
          date: new Date("2026-09-15"),
          personalAccountId,
        },
      });

      await bulkUpdateTransactions(
        TEST_USER_ID,
        [
          {
            id: txn.id,
            date: "2026-10-01",
          },
        ],
        false,
        db
      );

      const updated = await db.transaction.findUnique({ where: { id: txn.id } });
      expect(updated?.date.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    });
  });
});
