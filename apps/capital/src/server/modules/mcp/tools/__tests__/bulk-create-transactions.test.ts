import { describe, it, expect, beforeEach } from "vitest";
import { bulkCreateTransactions } from "../bulk-create-transactions";
import { prisma } from "@capital/server/lib/prisma";

const db = prisma;

// Test user ID - this should exist in the test database
const TEST_USER_ID = "test-user-mcp-001";

describe("MCP bulk create transactions", () => {
  let personalAccountId: string;

  beforeEach(async () => {
    // Setup test user and personal account
    // Clean up any existing test data first
    await db.transaction.deleteMany({
      where: {
        OR: [
          { business: { userId: TEST_USER_ID } },
          { personalAccount: { userId: TEST_USER_ID } },
        ],
      },
    });
    await db.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.user.deleteMany({ where: { id: TEST_USER_ID } });

    // Create test user
    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "mcp-test@example.com",
        passwordHash: "test-hash",
        name: "MCP Test User",
        baseCurrency: "BRL",
      },
    });

    // Create personal account
    const personalAccount = await db.personalAccount.create({
      data: {
        userId: TEST_USER_ID,
        defaultCurrency: "BRL",
      },
    });
    personalAccountId = personalAccount.id;

    // Create test category
    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Dividends",
        type: "income",
        isSystem: true,
      },
    });
  });

  it("should create transactions successfully in dry-run mode", async () => {
    const items = [
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 50.75,
        currency: "BRL",
        description: "PMLL11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-15",
        personalAccountId,
      },
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 35.20,
        currency: "BRL",
        description: "PVBI11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-20",
        personalAccountId,
      },
    ];

    const result = await bulkCreateTransactions(
      TEST_USER_ID,
      items,
      true, // dry-run
      db
    );

    expect(result.created).toHaveLength(2);
    expect(result.duplicates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    // Verify nothing was actually created
    const count = await db.transaction.count({
      where: { personalAccountId },
    });
    expect(count).toBe(0);
  });

  it("should create transactions successfully without dry-run", async () => {
    const items = [
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 50.75,
        currency: "BRL",
        description: "PMLL11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-15",
        personalAccountId,
      },
    ];

    const result = await bulkCreateTransactions(
      TEST_USER_ID,
      items,
      false, // not dry-run
      db
    );

    expect(result.created).toHaveLength(1);
    expect(result.created[0].id).not.toBe("dry-run");
    expect(result.created[0].description).toBe("PMLL11 - Dividends September 2026");
    expect(result.duplicates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    // Verify it was actually created
    const count = await db.transaction.count({
      where: { personalAccountId },
    });
    expect(count).toBe(1);
  });

  it("should detect duplicates by date + amount + description", async () => {
    // Create an existing transaction first
    await db.transaction.create({
      data: {
        entityType: "personal",
        type: "income",
        amount: 50.75,
        currency: "BRL",
        exchangeRate: 1,
        description: "PMLL11 - Dividends September 2026",
        category: "Dividends",
        date: new Date("2026-09-15"),
        personalAccountId,
      },
    });

    // Try to create the same transaction again
    const items = [
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 50.75,
        currency: "BRL",
        description: "PMLL11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-15",
        personalAccountId,
      },
    ];

    const result = await bulkCreateTransactions(
      TEST_USER_ID,
      items,
      false,
      db
    );

    expect(result.created).toHaveLength(0);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].description).toBe("PMLL11 - Dividends September 2026");
    expect(result.duplicates[0].existingId).not.toBe("within-batch");
    expect(result.errors).toHaveLength(0);

    // Verify no duplicate was created
    const count = await db.transaction.count({
      where: { personalAccountId },
    });
    expect(count).toBe(1);
  });

  it("should detect duplicates within the same batch", async () => {
    const items = [
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 50.75,
        currency: "BRL",
        description: "PMLL11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-15",
        personalAccountId,
      },
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 50.75,
        currency: "BRL",
        description: "PMLL11 - Dividends September 2026", // Same as above
        category: "Dividends",
        date: "2026-09-15",
        personalAccountId,
      },
    ];

    const result = await bulkCreateTransactions(
      TEST_USER_ID,
      items,
      false,
      db
    );

    expect(result.created).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].existingId).toBe("within-batch");
    expect(result.errors).toHaveLength(0);

    // Verify only one was created
    const count = await db.transaction.count({
      where: { personalAccountId },
    });
    expect(count).toBe(1);
  });

  it("should normalize description for duplicate detection (case-insensitive, trimmed)", async () => {
    // Create with lowercase and extra spaces
    await db.transaction.create({
      data: {
        entityType: "personal",
        type: "income",
        amount: 50.75,
        currency: "BRL",
        exchangeRate: 1,
        description: "  pmll11 - dividends september 2026  ",
        category: "Dividends",
        date: new Date("2026-09-15"),
        personalAccountId,
      },
    });

    // Try to create with different casing
    const items = [
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 50.75,
        currency: "BRL",
        description: "PMLL11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-15",
        personalAccountId,
      },
    ];

    const result = await bulkCreateTransactions(
      TEST_USER_ID,
      items,
      false,
      db
    );

    expect(result.created).toHaveLength(0);
    expect(result.duplicates).toHaveLength(1);
  });

  it("should handle errors gracefully and continue processing", async () => {
    const items = [
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 50.75,
        currency: "BRL",
        description: "PMLL11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-15",
        personalAccountId,
      },
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 35.20,
        currency: "BRL",
        description: "Invalid category test",
        category: "NonExistentCategory", // This should fail
        date: "2026-09-20",
        personalAccountId,
      },
      {
        entityType: "personal" as const,
        type: "income" as const,
        amount: 25.30,
        currency: "BRL",
        description: "PVBI11 - Dividends September 2026",
        category: "Dividends",
        date: "2026-09-22",
        personalAccountId,
      },
    ];

    const result = await bulkCreateTransactions(
      TEST_USER_ID,
      items,
      false,
      db
    );

    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].item.description).toBe("Invalid category test");
  });

  it("should create 15 dividend payments without duplicates (real-world scenario)", async () => {
    const dividends = Array.from({ length: 15 }, (_, i) => ({
      entityType: "personal" as const,
      type: "income" as const,
      amount: 50.75 + i * 0.5,
      currency: "BRL",
      description: `Dividend Payment ${i + 1} - PMLL11`,
      category: "Dividends",
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      personalAccountId,
    }));

    const result = await bulkCreateTransactions(
      TEST_USER_ID,
      dividends,
      false,
      db
    );

    expect(result.created).toHaveLength(15);
    expect(result.duplicates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    const count = await db.transaction.count({
      where: { personalAccountId },
    });
    expect(count).toBe(15);
  });
});
