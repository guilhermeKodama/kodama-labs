import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { internalCategoryName } from "@capital/server/modules/categories/lib/internal-category";
import { categorizeClaimedBillChunk } from "../categorize-bills/categorize-bill-chunk";
import { categorizeClaimedStatementImport } from "../categorize-statements/categorize-statement-import";

const db = prisma;
const USER = "test-user-cron-archive";

describe("cron categorizers assign an archived system category", () => {
  let personalAccountId: string;

  beforeEach(async () => {
    await db.user.deleteMany({ where: { id: USER } });
    await db.user.create({
      data: {
        id: USER,
        email: "cron-archive@example.com",
        passwordHash: "hash",
        name: "Cron",
        baseCurrency: "BRL",
      },
    });
    personalAccountId = (await db.personalAccount.create({
      data: { userId: USER, defaultCurrency: "BRL" },
    })).id;
  });

  it("writes archived other_system onto a bill row", async () => {
    const otherName = await internalCategoryName(USER, "other_system", db);
    await db.category.updateMany({
      where: { userId: USER, systemKey: "other_system" },
      data: { isArchived: true },
    });

    const card = await db.creditCard.create({
      data: {
        entityType: "personal",
        bankName: "Nubank",
        lastFourDigits: "3308",
        creditLimit: 1000,
        closingDay: 1,
        dueDay: 8,
        currency: "BRL",
        personalAccountId,
      },
    });
    const bill = await db.creditCardBill.create({
      data: {
        creditCardId: card.id,
        closingDate: new Date("2026-10-01T12:00:00.000Z"),
        dueDate: new Date("2026-10-08T12:00:00.000Z"),
        totalAmount: 15,
        categorizationStatus: "processing",
      },
    });
    await db.billTransaction.create({
      data: {
        billId: bill.id,
        category: "Uncategorized",
        transactionDate: new Date("2026-10-02T12:00:00.000Z"),
        description: "store",
        amount: 15,
        currency: "BRL",
      },
    });

    const result = await categorizeClaimedBillChunk(db, {
      billId: bill.id,
      userId: USER,
      categorize: async () => [{ index: 0, category: otherName }],
    });

    expect(result).toMatchObject({
      kind: "chunk",
      status: "completed",
      processedInThisRun: 1,
      remaining: 0,
    });
    const saved = await db.billTransaction.findFirst({ where: { billId: bill.id } });
    expect(saved?.category).toBe(otherName);
    expect(saved?.isAutoCategorized).toBe(true);
    const stillArchived = await db.category.findFirst({
      where: { userId: USER, systemKey: "other_system" },
    });
    expect(stillArchived?.isArchived).toBe(true);
  });

  it("writes archived other_system onto a statement transaction", async () => {
    const otherName = await internalCategoryName(USER, "other_system", db);
    await db.category.updateMany({
      where: { userId: USER, systemKey: "other_system" },
      data: { isArchived: true },
    });

    const statementImport = await db.statementImport.create({
      data: {
        userId: USER,
        entityType: "personal",
        personalAccountId,
        transactionCount: 1,
        categorizationStatus: "processing",
      },
    });
    await db.transaction.create({
      data: {
        entityType: "personal",
        type: "expense",
        amount: 22,
        currency: "BRL",
        exchangeRate: 1,
        description: "pix",
        category: "Uncategorized",
        date: new Date("2026-10-04T12:00:00.000Z"),
        personalAccountId,
        statementImportId: statementImport.id,
      },
    });

    const result = await categorizeClaimedStatementImport(db, {
      importId: statementImport.id,
      userId: USER,
      categorize: async () => [{ index: 0, category: otherName }],
    });

    expect(result.transactionCount).toBe(1);
    const saved = await db.transaction.findFirst({
      where: { statementImportId: statementImport.id },
    });
    expect(saved?.category).toBe(otherName);
    const stillArchived = await db.category.findFirst({
      where: { userId: USER, systemKey: "other_system" },
    });
    expect(stillArchived?.isArchived).toBe(true);
  });
});
