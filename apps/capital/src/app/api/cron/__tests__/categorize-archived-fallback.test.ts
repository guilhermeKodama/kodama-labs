import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { categorizePendingEntries } from "@capital/server/modules/categories/services/ai-categorize";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { executeImport } from "@capital/server/modules/bank-statements/services/execute-import";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createRule } from "@capital/server/modules/ledger/services/rules";

const USER = "test-user-cron-archive";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("categorize cron", () => {
  it("assigns the archived system Other to card and bank rows and skips manual blanks", async () => {
    const other = await getSystemCategory(USER, "other_system", prisma);
    await prisma.category.update({ where: { id: other.id }, data: { isArchived: true } });
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-10", description: "cafe", amount: 12 }], fallback: "none" }, prisma);
    const imp = await executeImport(
      USER,
      {
        entityType: "personal",
        entityId: f.pfId,
        currency: "BRL",
        transactions: [{ externalId: "e1", date: "2026-09-02", description: "pix", amount: 5, type: "expense" }],
        transfers: [],
        investmentTransfers: [],
        creditCards: [],
        bills: [],
        reconciliations: [],
        transferReconciliations: [],
        duplicateDecisions: [],
        investmentTransactions: [],
      },
      prisma
    );
    const manual = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 1, date: "2026-09-03", description: "manual" }, prisma, { skipRules: true })).entryIds[0];

    const bill = vi.fn(async (rows: { index: number }[], _c: string[], fb: string) => rows.map((r) => ({ index: r.index, category: fb })));
    const statement = vi.fn(async (rows: { index: number }[], _c: string[], _t: string, fb: string) => rows.map((r) => ({ index: r.index, category: fb })));
    const r = await categorizePendingEntries(prisma, { bill, statement }, USER);
    expect(r).toMatchObject({ userId: USER, processed: 2, remaining: 0 });
    expect(bill).toHaveBeenCalledTimes(1);
    expect(statement).toHaveBeenCalledTimes(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: other.id, isAutoCategorized: true } })).toBe(2);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: manual } })).categoryId).toBeNull();
    expect((await prisma.import.findUniqueOrThrow({ where: { id: imp.statementImportId } })).categorizationStatus).toBe("completed");
  });

  it("learns ai rules for real answers but never overwrites a manual rule", async () => {
    await createRule(USER, { matchType: "equals", pattern: "padaria", categoryId: f.categories.Groceries }, prisma);
    await importCardStatement(
      USER,
      {
        accountId: f.card,
        month: "2026-09",
        rows: [
          { date: "2026-08-10", description: "Figma", amount: 50 },
          { date: "2026-08-11", description: "Zaffari", amount: 80 },
          { date: "2026-08-12", description: "Padaria", amount: 9 },
        ],
        fallback: "none",
      },
      prisma
    );
    // The rule existing at import time already categorized "Padaria".
    // A manual rule added afterwards must survive the AI's answer.
    await createRule(USER, { matchType: "equals", pattern: "zaffari", categoryId: f.categories.Groceries }, prisma);
    const bill = vi.fn(async (rows: { index: number }[]) => rows.map((r) => ({ index: r.index, category: "Software" })));
    await categorizePendingEntries(prisma, { bill }, USER);
    expect(bill.mock.calls[0][0]).toHaveLength(2);
    const rules = await prisma.categorizationRule.findMany({ where: { userId: USER }, orderBy: { pattern: "asc" } });
    expect(rules.map((x) => [x.pattern, x.source, x.categoryId])).toEqual([
      ["figma", "ai", f.categories.Software],
      ["padaria", "manual", f.categories.Groceries],
      ["zaffari", "manual", f.categories.Groceries],
    ]);
  });
});
