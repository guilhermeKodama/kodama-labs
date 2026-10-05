import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createBudget } from "@capital/server/modules/budgets/services/budget-crud";
import { monthOverview } from "@capital/server/modules/budgets/services/budget-overview";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createRecurringRule } from "@capital/server/modules/recurring/services/recurring-rules";
import { bulkCreateTransactions } from "../bulk-create-transactions";
import { createBudget as createBudgetTool } from "../budgets";
import { mergeCategoryTool, updateCategoryTool } from "../categories";
import { importCreditCardStatement } from "../credit-card-statements";
import { listCategoriesForMcp } from "../metadata";
import { updateTransactionTool } from "../manage-transactions";

const USER = "test-user-mcp-category-archive-001";
const OTHER = "test-user-mcp-category-archive-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Travel", type: "expense" }, { name: "Food", type: "expense" }, { name: "Freelance", type: "income" }] });
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("category archive", () => {
  it("hides an archived category from list_categories until includeArchived", async () => {
    await updateCategoryTool(USER, { id: f.categories.Travel, isArchived: true }, prisma);
    expect((await listCategoriesForMcp(USER, "expense", prisma)).categories.map((c) => c.name)).not.toContain("Travel");
    const all = await listCategoriesForMcp(USER, "expense", prisma, true);
    expect(all.categories.find((c) => c.id === f.categories.Travel)?.isArchived).toBe(true);
  });

  it("rejects new assignments but internal fallbacks still write an archived Other", async () => {
    await updateCategoryTool(USER, { id: f.categories.Food, isArchived: true }, prisma);
    await expect(
      bulkCreateTransactions(USER, [{ entityType: "personal", type: "expense", amount: 1, currency: "BRL", description: "x", category: "Food", date: "2026-09-01", personalAccountId: f.pfId }], false, prisma)
    ).rejects.toThrow(/archived/);

    const other = await getSystemCategory(USER, "other_system", prisma);
    await prisma.category.update({ where: { id: other.id }, data: { isArchived: true } });
    const imported = await importCreditCardStatement(USER, { creditCardId: f.card, statement: { month: "2026-09" }, rows: [{ date: "2026-08-20", description: "cafe", amount: 12 }] }, prisma);
    const purchase = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: imported.createdIds[0] } });
    expect(purchase.categoryId).toBe(other.id);
  });

  it("rejects a merge into an archived category and allows renaming an archived one", async () => {
    const consulting = await prisma.category.create({ data: { userId: USER, name: "Consulting", type: "income", isArchived: true } });
    await expect(mergeCategoryTool(USER, { fromId: f.categories.Freelance, toId: consulting.id }, prisma)).rejects.toThrow(/archived/);
    const renamed = await updateCategoryTool(USER, { id: f.categories.Freelance, isArchived: true, name: "Contract work" }, prisma);
    expect(renamed).toMatchObject({ name: "Contract work", isArchived: true });
  });

  it("keeps budget and transaction totals after the category is archived", async () => {
    await createBudget(USER, { categoryId: f.categories.Food, amount: 300, effectiveFrom: "2026-08" }, prisma);
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 120, date: "2026-08-10", description: "x", categoryId: f.categories.Food }, prisma);
    await updateCategoryTool(USER, { id: f.categories.Food, isArchived: true }, prisma);
    const o = await monthOverview(USER, 2026, 8, prisma);
    expect(o.budgets.find((b) => b.categoryId === f.categories.Food)).toMatchObject({ amount: 300, spent: 120 });
  });

  it("allows an update that keeps an archived category and rejects switching to one", async () => {
    const { entryIds } = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-08-10", description: "x", categoryId: f.categories.Food }, prisma);
    await updateCategoryTool(USER, { id: f.categories.Food, isArchived: true }, prisma);
    await expect(updateTransactionTool(USER, { id: entryIds[0], category: "Food", amount: 6 }, prisma)).resolves.toMatchObject({ amount: 6, category: "Food" });
    await updateCategoryTool(USER, { id: f.categories.Travel, isArchived: true }, prisma);
    await expect(updateTransactionTool(USER, { id: entryIds[0], category: "Travel" }, prisma)).rejects.toThrow(/archived/);
  });

  it("does not let another user archive the category", async () => {
    await expect(updateCategoryTool(OTHER, { id: f.categories.Food, isArchived: true }, prisma)).rejects.toThrow(/not found/);
  });

  it("rejects new budgets and recurring rules on an archived category", async () => {
    await updateCategoryTool(USER, { id: f.categories.Food, isArchived: true }, prisma);
    await expect(createBudgetTool(USER, { accountId: f.pfId, category: "Food", amount: 10, currency: "BRL", effectiveFrom: "2026-09-01" }, prisma)).rejects.toThrow(/archived/);
    await expect(createBudget(USER, { categoryId: f.categories.Food, amount: 10, effectiveFrom: "2026-09" }, prisma)).rejects.toThrow(/archived/);
    await expect(
      createRecurringRule(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "r", categoryId: f.categories.Food, frequency: "monthly", startDate: "2026-09-01" }, prisma)
    ).rejects.toThrow(/archived/);
  });
});
