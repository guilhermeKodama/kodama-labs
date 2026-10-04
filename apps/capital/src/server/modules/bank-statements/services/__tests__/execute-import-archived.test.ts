import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { executeImport } from "../execute-import";
import { isBankStatementClientError } from "../../routes/v1/post-import";

const db = prisma;
const USER = "test-user-import-archived";

describe("executeImport archived category", () => {
  let personalAccountId: string;

  beforeEach(async () => {
    await db.user.deleteMany({ where: { id: USER } });
    await db.user.create({
      data: {
        id: USER,
        email: "import-archived@example.com",
        passwordHash: "hash",
        name: "Import",
        baseCurrency: "BRL",
      },
    });
    personalAccountId = (await db.personalAccount.create({
      data: { userId: USER, defaultCurrency: "BRL" },
    })).id;
  });

  it("rejects an explicit archived category and imports a row with no category", async () => {
    await db.category.create({
      data: { userId: USER, name: "Groceries", type: "expense", isArchived: true },
    });

    const archivedMessage = "Category 'Groceries' is archived and cannot be assigned. Unarchive it or choose a visible category. Row: market";
    await expect(executeImport(USER, {
      entityType: "personal",
      entityId: personalAccountId,
      currency: "BRL",
      transactions: [{
        externalId: "ext-archived",
        date: "2026-10-12",
        description: "market",
        amount: 10,
        type: "expense",
        category: "Groceries",
      }],
      transfers: [],
      investmentTransfers: [],
      creditCards: [],
      bills: [],
      reconciliations: [],
      transferReconciliations: [],
      duplicateDecisions: [],
      investmentTransactions: [],
    }, db)).rejects.toThrow(archivedMessage);

    expect(isBankStatementClientError(archivedMessage)).toBe(true);
    expect(isBankStatementClientError(
      "Cannot change transfer abc to direction \"capital_injection\" via reconciliation"
    )).toBe(true);
    expect(await db.transaction.count({ where: { personalAccountId } })).toBe(0);
    expect(await db.statementImport.count({ where: { userId: USER } })).toBe(0);

    const imported = await executeImport(USER, {
      entityType: "personal",
      entityId: personalAccountId,
      currency: "BRL",
      transactions: [{
        externalId: "ext-open",
        date: "2026-10-13",
        description: "pix",
        amount: 20,
        type: "expense",
      }],
      transfers: [],
      investmentTransfers: [],
      creditCards: [],
      bills: [],
      reconciliations: [],
      transferReconciliations: [],
      duplicateDecisions: [],
      investmentTransactions: [],
    }, db);

    expect(imported.imported).toBe(1);
    const row = await db.transaction.findFirst({
      where: { personalAccountId, externalId: "ext-open" },
    });
    expect(row?.category).toBe("Uncategorized");
  });
});
