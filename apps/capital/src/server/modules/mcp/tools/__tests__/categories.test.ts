import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createBudget } from "@capital/server/modules/budgets/services/budget-crud";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createRule } from "@capital/server/modules/ledger/services/rules";
import { createRecurringRule } from "@capital/server/modules/recurring/services/recurring-rules";
import { createCategoryTool, deleteCategoryTool, mergeCategoryTool, updateCategoryTool } from "../categories";

const USER = "test-user-mcp-categories-001";
const MISSING = "00000000-0000-0000-0000-000000000000";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Food", type: "expense" }, { name: "Eating Out", type: "expense" }, { name: "Consulting", type: "income" }] });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const expense = (categoryId: string, accountId = f.pfChecking) =>
  createEntry(USER, { kind: "expense", accountId, amount: 10, date: "2026-09-02", description: "x", categoryId }, prisma, { skipRules: true });

describe("create_category / update_category", () => {
  it("creates categories of every type and rejects a duplicate name", async () => {
    for (const type of ["income", "expense", "investment"] as const) {
      const c = await createCategoryTool(USER, { name: `New ${type}`, type, color: "#123456", icon: "tag" }, prisma);
      expect(c).toMatchObject({ name: `New ${type}`, type, color: "#123456", isArchived: false });
    }
    await expect(createCategoryTool(USER, { name: "Food", type: "expense" }, prisma)).rejects.toThrow(/already exists/);
  });

  it("renames in place: entries, card purchases and budgets follow the id", async () => {
    await expense(f.categories.Food);
    await expense(f.categories.Food, f.card);
    await createBudget(USER, { categoryId: f.categories.Food, amount: 100, effectiveFrom: "2026-09" }, prisma);
    const r = await updateCategoryTool(USER, { id: f.categories.Food, name: "Alimentação", color: "#f00" }, prisma);
    expect(r).toMatchObject({ name: "Alimentação", color: "#f00" });
    expect(await prisma.ledgerEntry.count({ where: { categoryId: f.categories.Food } })).toBe(2);
  });

  it("renames system categories (localization) but keeps their key and type", async () => {
    const card = await getSystemCategory(USER, "credit_card", prisma);
    const r = await updateCategoryTool(USER, { id: card.id, name: "Cartão de Crédito" }, prisma);
    expect(r).toMatchObject({ name: "Cartão de Crédito", systemKey: "credit_card" });
    expect((await getSystemCategory(USER, "credit_card", prisma)).id).toBe(card.id);
    await expect(updateCategoryTool(USER, { id: card.id, type: "income" }, prisma)).rejects.toThrow(/Cannot change type of system category/);
  });

  it("rejects renaming onto an existing name, retyping a used category, and unknown ids", async () => {
    await expect(updateCategoryTool(USER, { id: f.categories.Food, name: "Eating Out" }, prisma)).rejects.toThrow(/merge_categories/);
    await expense(f.categories.Food);
    await expect(updateCategoryTool(USER, { id: f.categories.Food, type: "income" }, prisma)).rejects.toThrow(/Cannot change category type/);
    await expect(updateCategoryTool(USER, { id: MISSING, name: "x" }, prisma)).rejects.toThrow(/not found/);
  });

  it("does not touch a same-named category of the other type", async () => {
    const incomeFood = await prisma.category.create({ data: { userId: USER, name: "Food", type: "income" } });
    await updateCategoryTool(USER, { id: f.categories.Food, name: "Groceries" }, prisma);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: incomeFood.id } })).name).toBe("Food");
  });
});

describe("delete_category", () => {
  it("deletes an unused category and refuses one in use without reassignTo", async () => {
    const tmp = await createCategoryTool(USER, { name: "Tmp", type: "expense" }, prisma);
    expect(await deleteCategoryTool(USER, { id: tmp.id }, prisma)).toEqual({ success: true, id: tmp.id });
    await expense(f.categories.Food);
    await expect(deleteCategoryTool(USER, { id: f.categories.Food }, prisma)).rejects.toThrow(/linked records: 1 transaction/);
  });

  it("reassigns entries, recurring rules, budgets and rules atomically", async () => {
    await expense(f.categories.Food);
    await createRecurringRule(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "r", categoryId: f.categories.Food, frequency: "monthly", startDate: "2026-09-01" }, prisma);
    await createBudget(USER, { categoryId: f.categories.Food, amount: 100, effectiveFrom: "2026-09" }, prisma);
    await createRule(USER, { matchType: "contains", pattern: "ifood", categoryId: f.categories.Food }, prisma);
    await deleteCategoryTool(USER, { id: f.categories.Food, reassignTo: f.categories["Eating Out"] }, prisma);
    const target = f.categories["Eating Out"];
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: target } })).toBe(1);
    expect(await prisma.recurringRule.count({ where: { userId: USER, categoryId: target } })).toBe(1);
    expect(await prisma.budget.count({ where: { userId: USER, categoryId: target } })).toBe(1);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, categoryId: target } })).toBe(1);
  });

  it("guards: itself, other type, default/system categories", async () => {
    await expect(deleteCategoryTool(USER, { id: f.categories.Food, reassignTo: f.categories.Food }, prisma)).rejects.toThrow(/itself/);
    await expense(f.categories.Food);
    await expect(deleteCategoryTool(USER, { id: f.categories.Food, reassignTo: f.categories.Consulting }, prisma)).rejects.toThrow(/different type/);
    const sys = await getSystemCategory(USER, "groceries", prisma);
    await expect(deleteCategoryTool(USER, { id: sys.id }, prisma)).rejects.toThrow(/system category 'Groceries' \(systemKey: groceries\)/);
    const def = await prisma.category.create({ data: { userId: USER, name: "Legacy default", type: "expense", isDefault: true } });
    await expect(deleteCategoryTool(USER, { id: def.id }, prisma)).rejects.toThrow(/Cannot delete default categories/);
    const legacySys = await prisma.category.create({ data: { userId: USER, name: "Legacy system", type: "expense", isSystem: true } });
    await expect(deleteCategoryTool(USER, { id: legacySys.id }, prisma)).rejects.toThrow(/Cannot delete system categories/);
  });
});

describe("merge_categories", () => {
  it("moves everything and reports counts", async () => {
    await expense(f.categories.Food);
    await expense(f.categories.Food, f.card);
    await createBudget(USER, { categoryId: f.categories.Food, amount: 100, effectiveFrom: "2026-09" }, prisma);
    const r = await mergeCategoryTool(USER, { fromId: f.categories.Food, toId: f.categories["Eating Out"] }, prisma);
    expect(r).toMatchObject({ success: true, fromCategory: "Food", toCategory: "Eating Out", transactionsMoved: 2, budgetsMoved: 1, recurringTransactionsMoved: 0 });
    expect(await prisma.category.count({ where: { id: f.categories.Food } })).toBe(0);
  });

  it("guards: itself, other type, system/default source, budget collisions", async () => {
    await expect(mergeCategoryTool(USER, { fromId: f.categories.Food, toId: f.categories.Food }, prisma)).rejects.toThrow(/into itself/);
    await expect(mergeCategoryTool(USER, { fromId: f.categories.Food, toId: f.categories.Consulting }, prisma)).rejects.toThrow(/different types/);
    const sys = await getSystemCategory(USER, "groceries", prisma);
    await expect(mergeCategoryTool(USER, { fromId: sys.id, toId: f.categories.Food }, prisma)).rejects.toThrow(/Cannot merge from system category/);
    const def = await prisma.category.create({ data: { userId: USER, name: "Legacy default", type: "expense", isDefault: true } });
    await expect(mergeCategoryTool(USER, { fromId: def.id, toId: f.categories.Food }, prisma)).rejects.toThrow(/default category/);
    expect((await mergeCategoryTool(USER, { fromId: f.categories["Eating Out"], toId: sys.id }, prisma)).success).toBe(true);

    await createBudget(USER, { categoryId: f.categories.Food, amount: 100, effectiveFrom: "2026-09" }, prisma);
    await createBudget(USER, { categoryId: sys.id, amount: 100, effectiveFrom: "2026-09" }, prisma);
    await expect(mergeCategoryTool(USER, { fromId: f.categories.Food, toId: sys.id }, prisma)).rejects.toThrow(/Cannot reassign budgets/);
    expect(await prisma.category.count({ where: { id: f.categories.Food } })).toBe(1);
  });
});
