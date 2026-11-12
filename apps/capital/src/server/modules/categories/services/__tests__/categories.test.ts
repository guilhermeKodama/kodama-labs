import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry, softDeleteEntries } from "@capital/server/modules/ledger/services/entries";
import { createBudget } from "@capital/server/modules/budgets/services/budget-crud";
import { createRecurringRule } from "@capital/server/modules/recurring/services/recurring-rules";
import { createRule } from "@capital/server/modules/ledger/services/rules";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { getSystemCategory } from "../../lib/system-categories";
import {
  categoryCounts,
  categoryUsage,
  createCategory,
  deleteCategory,
  findUncategorized,
  getOwnedCategory,
  listCategories,
  mergeCategories,
  serializeCategory,
  updateCategory,
} from "../categories";
import { fetchCategoriesByUserId, fetchCategoryById } from "../../data/queries/fetch-categories";

const USER = "test-user-categories-service-001";
const OTHER = "test-user-categories-service-002";
let f: LedgerFixture;
let o: LedgerFixture;
let c: Record<string, string>;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Mercado", type: "expense" },
      { name: "Feira", type: "expense" },
      { name: "Lazer", type: "expense" },
      { name: "Salario", type: "income" },
      { name: "Bonus", type: "income" },
    ],
  });
  o = await createLedgerFixture(prisma, OTHER);
  c = f.categories;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const spend = (categoryId: string, amount = 10, date = "2026-09-10", description = "Compra") =>
  createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount, date, description, categoryId }, prisma, { skipRules: true });

describe("createCategory and listCategories", () => {
  it("trims the name, stores color and icon, and refuses a blank name", async () => {
    const made = await createCategory(USER, { name: "  Pets  ", type: "expense", color: "#112233", icon: "paw" }, prisma);
    expect(made).toMatchObject({ name: "Pets", type: "expense", color: "#112233", icon: "paw", userId: USER, isArchived: false });
    const bare = await createCategory(USER, { name: "Plain", type: "income" }, prisma);
    expect(bare).toMatchObject({ color: null, icon: null });
    await expect(createCategory(USER, { name: "   ", type: "expense" }, prisma)).rejects.toMatchObject({ status: 422, code: "category.name_required" });
  });

  it("refuses a name already used for the same type, but not for the other type", async () => {
    await expect(createCategory(USER, { name: "Mercado", type: "expense" }, prisma)).rejects.toMatchObject({ status: 409, code: "category.name_taken", params: { name: "Mercado", type: "expense" } });
    await expect(createCategory(USER, { name: "Mercado", type: "income" }, prisma)).resolves.toMatchObject({ type: "income" });
  });

  it("lets an unexpected database error through", async () => {
    await expect(createCategory("test-user-categories-service-ghost", { name: "X", type: "expense" }, prisma)).rejects.toMatchObject({ code: "P2003" });
  });

  it("lists by type, hides archived ones unless asked, ordered by type (income first) then name", async () => {
    await prisma.category.update({ where: { id: c.Lazer }, data: { isArchived: true } });
    expect((await listCategories(USER, prisma)).map((x) => x.name)).toEqual(["Bonus", "Salario", "Feira", "Mercado"]);
    expect((await listCategories(USER, prisma, { includeArchived: true })).map((x) => x.name)).toEqual(["Bonus", "Salario", "Feira", "Lazer", "Mercado"]);
    expect((await listCategories(USER, prisma, { type: "income" })).map((x) => x.name)).toEqual(["Bonus", "Salario"]);
    expect(await listCategories(USER, prisma, { type: "investment" })).toEqual([]);
  });

  it("finds a category only for its owner", async () => {
    expect((await getOwnedCategory(USER, c.Mercado, prisma)).name).toBe("Mercado");
    await expect(getOwnedCategory(OTHER, c.Mercado, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    expect((await fetchCategoryById(USER, c.Mercado, prisma))?.name).toBe("Mercado");
    expect(await fetchCategoryById(OTHER, c.Mercado, prisma)).toBeNull();
    expect((await fetchCategoriesByUserId(USER, undefined, prisma)).map((x) => x.name)).toEqual(["Bonus", "Feira", "Lazer", "Mercado", "Salario"]);
    expect((await fetchCategoriesByUserId(USER, "income", prisma)).map((x) => x.name)).toEqual(["Bonus", "Salario"]);
    await prisma.category.update({ where: { id: c.Bonus }, data: { isArchived: true } });
    expect((await fetchCategoriesByUserId(USER, "income", prisma)).map((x) => x.name)).toEqual(["Salario"]);
    expect((await fetchCategoriesByUserId(USER, "income", prisma, { includeArchived: true })).map((x) => x.name)).toEqual(["Bonus", "Salario"]);
  });
});

describe("usage and counts", () => {
  it("counts what points at a category, trashed entries aside", async () => {
    await spend(c.Mercado);
    const trashed = await spend(c.Mercado);
    await softDeleteEntries(USER, trashed.entryIds, prisma);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01" }, prisma);
    await createRecurringRule(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "Feira", frequency: "monthly", startDate: "2026-10-01", categoryId: c.Mercado }, prisma);
    await createRule(USER, { matchType: "contains", pattern: "mercado", categoryId: c.Mercado }, prisma);
    expect(await categoryUsage(USER, c.Mercado, prisma)).toEqual({ entries: 1, recurring: 1, budgets: 1, rules: 1, total: 4 });
    expect(await categoryUsage(USER, c.Lazer, prisma)).toEqual({ entries: 0, recurring: 0, budgets: 0, rules: 0, total: 0 });
  });

  it("counts live entries and budget chains per category, not versions", async () => {
    await spend(c.Mercado);
    await spend(c.Mercado);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01", entityId: f.pfId }, prisma);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01", entityId: f.pjId }, prisma);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-06", entityId: f.pfId, period: "yearly" }, prisma);
    await prisma.budget.create({ data: { userId: USER, entityId: f.pfId, categoryId: c.Mercado, amount: 50, currency: "BRL", period: "monthly", year: 2026, month: 5, effectiveFrom: new Date("2026-05-01T12:00:00Z") } });
    const counts = await categoryCounts(USER, prisma);
    expect(counts.get(c.Mercado)).toEqual({ entries: 2, budgets: 3 });
    expect(counts.get(c.Lazer)).toEqual({ entries: 0, budgets: 0 });
    expect(counts.has(o.categories.Groceries)).toBe(false);
  });
});

describe("updateCategory", () => {
  it("renames, recolors and archives in one undoable batch, trimming the name", async () => {
    const r = await updateCategory(USER, c.Mercado, { name: "  Supermercado ", color: "#abcdef", icon: "cart", isArchived: true }, prisma);
    expect(r).toMatchObject({ name: "Supermercado", color: "#abcdef", icon: "cart", isArchived: true });
    await undoBatch(USER, r.batchId, prisma);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: c.Mercado } })).toMatchObject({ name: "Mercado", color: null, isArchived: false });
    const cleared = await updateCategory(USER, c.Mercado, { color: null, icon: null }, prisma);
    expect(cleared).toMatchObject({ color: null, icon: null, name: "Mercado" });
  });

  it("404s for someone else's category, and never changes the system key", async () => {
    await expect(updateCategory(OTHER, c.Mercado, { name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await expect(updateCategory(USER, c.Mercado, { systemKey: "hacked" }, prisma)).rejects.toMatchObject({ status: 422, code: "category.system_key_immutable" });
    expect((await prisma.category.findUniqueOrThrow({ where: { id: c.Mercado } })).systemKey).toBeNull();
  });

  it("refuses a name another category of the same type has, keeping the same name or a blank one harmless", async () => {
    await expect(updateCategory(USER, c.Mercado, { name: "Feira" }, prisma)).rejects.toMatchObject({ status: 409, code: "category.name_taken", params: { name: "Feira", type: "expense" } });
    expect((await updateCategory(USER, c.Mercado, { name: "Mercado" }, prisma)).name).toBe("Mercado");
    expect((await updateCategory(USER, c.Mercado, { name: "   ", color: "#000000" }, prisma)).name).toBe("Mercado");
    // The same name is fine under the other type.
    await expect(updateCategory(USER, c.Salario, { name: "Mercado" }, prisma)).resolves.toMatchObject({ name: "Mercado", type: "income" });
  });

  it("retypes an unused category, and checks the new name against the new type", async () => {
    const r = await updateCategory(USER, c.Lazer, { type: "income" }, prisma);
    expect(r.type).toBe("income");
    await expect(updateCategory(USER, c.Feira, { type: "income", name: "Salario" }, prisma)).rejects.toMatchObject({ code: "category.name_taken", params: { name: "Salario", type: "income" } });
    expect((await updateCategory(USER, c.Feira, { type: "expense" }, prisma)).type).toBe("expense");
  });

  it("keeps the type of a system category and of one that entries use", async () => {
    const system = await getSystemCategory(USER, "other_system", prisma);
    await expect(updateCategory(USER, system.id, { type: "income" }, prisma)).rejects.toMatchObject({ status: 422, code: "category.system_type_locked", params: { name: system.name } });
    await spend(c.Mercado);
    await expect(updateCategory(USER, c.Mercado, { type: "income" }, prisma)).rejects.toMatchObject({ status: 422, code: "category.type_in_use", params: { count: 1 } });
    expect((await prisma.category.findUniqueOrThrow({ where: { id: c.Mercado } })).type).toBe("expense");
  });
});

describe("deleteCategory", () => {
  it("deletes an unused category and undo brings it back", async () => {
    const r = await deleteCategory(USER, c.Lazer, undefined, prisma);
    expect(r).toMatchObject({ success: true, id: c.Lazer });
    expect(await prisma.category.count({ where: { id: c.Lazer } })).toBe(0);
    await undoBatch(USER, r.batchId, prisma);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: c.Lazer } })).toMatchObject({ name: "Lazer" });
  });

  it("refuses one in use and says what uses it", async () => {
    await spend(c.Mercado);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01" }, prisma);
    await expect(deleteCategory(USER, c.Mercado, undefined, prisma)).rejects.toMatchObject({
      status: 409,
      code: "category.in_use",
      params: { entries: 1, recurring: 0, budgets: 1, rules: 0 },
    });
  });

  it("refuses system, default and system-flagged categories", async () => {
    const system = await getSystemCategory(USER, "other_system", prisma);
    await expect(deleteCategory(USER, system.id, undefined, prisma)).rejects.toMatchObject({ code: "category.system_protected", params: { name: system.name } });
    const defaulted = await prisma.category.create({ data: { userId: USER, name: "Padrao", type: "expense", isDefault: true } });
    await expect(deleteCategory(USER, defaulted.id, undefined, prisma)).rejects.toMatchObject({ status: 422, code: "category.default_protected" });
    const flagged = await prisma.category.create({ data: { userId: USER, name: "Sistema", type: "expense", isSystem: true } });
    await expect(deleteCategory(USER, flagged.id, undefined, prisma)).rejects.toMatchObject({ code: "category.system_protected", params: { name: "Sistema" } });
    await expect(deleteCategory(OTHER, c.Lazer, undefined, prisma)).rejects.toMatchObject({ code: "category.not_found" });
  });

  it("moves everything to the category it is reassigned to, trashed entries included, in one undoable batch", async () => {
    const live = await spend(c.Mercado, 10);
    const trashed = await spend(c.Mercado, 20, "2026-09-11");
    await softDeleteEntries(USER, trashed.entryIds, prisma);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01" }, prisma);
    const rec = await createRecurringRule(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "Feira", frequency: "monthly", startDate: "2026-10-01", categoryId: c.Mercado }, prisma);
    const rule = await createRule(USER, { matchType: "contains", pattern: "mercado", categoryId: c.Mercado }, prisma);

    const r = await deleteCategory(USER, c.Mercado, c.Feira, prisma);
    expect(await prisma.category.count({ where: { id: c.Mercado } })).toBe(0);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: live.entryIds[0] } })).categoryId).toBe(c.Feira);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: trashed.entryIds[0] } })).categoryId).toBe(c.Feira);
    expect((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rec.id } })).categoryId).toBe(c.Feira);
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).categoryId).toBe(c.Feira);
    expect(await prisma.budget.count({ where: { userId: USER, categoryId: c.Feira } })).toBe(1);

    await undoBatch(USER, r.batchId, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: live.entryIds[0] } })).categoryId).toBe(c.Mercado);
    expect((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rec.id } })).categoryId).toBe(c.Mercado);
    expect(await prisma.budget.count({ where: { userId: USER, categoryId: c.Mercado } })).toBe(1);
  });

  it("clears trashed entries of a category with no live use rather than blocking", async () => {
    const e = await spend(c.Lazer);
    await softDeleteEntries(USER, e.entryIds, prisma);
    const r = await deleteCategory(USER, c.Lazer, undefined, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBeNull();
    await undoBatch(USER, r.batchId, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBe(c.Lazer);
  });

  it("refuses a reassignment to itself, to a missing category, to another user's, or to one of another type", async () => {
    await expect(deleteCategory(USER, c.Mercado, c.Mercado, prisma)).rejects.toMatchObject({ status: 422, code: "category.reassign_self" });
    await expect(deleteCategory(USER, c.Mercado, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "category.target_not_found" });
    await expect(deleteCategory(USER, c.Mercado, o.categories.Groceries, prisma)).rejects.toMatchObject({ code: "category.target_not_found" });
    await expect(deleteCategory(USER, c.Mercado, c.Salario, prisma)).rejects.toMatchObject({ status: 422, code: "category.type_mismatch", params: { from: "expense", to: "income" } });
    expect(await prisma.category.count({ where: { id: c.Mercado } })).toBe(1);
  });

  it("refuses a reassignment when the target already has a budget in the same slot", async () => {
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01", entityId: f.pfId }, prisma);
    await createBudget(USER, { categoryId: c.Feira, amount: 50, effectiveFrom: "2026-01", entityId: f.pfId }, prisma);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-02" }, prisma);
    await expect(deleteCategory(USER, c.Mercado, c.Feira, prisma)).rejects.toMatchObject({ status: 409, code: "category.reassign_budget_clash", params: { count: 1 } });
    expect(await prisma.budget.count({ where: { userId: USER, categoryId: c.Mercado } })).toBe(2);
  });
});

describe("mergeCategories", () => {
  it("moves everything and drops the source, counting what moved; undo re-creates the source", async () => {
    const e = await spend(c.Mercado);
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01" }, prisma);
    await createRecurringRule(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "Feira", frequency: "monthly", startDate: "2026-10-01", categoryId: c.Mercado }, prisma);
    await createRule(USER, { matchType: "contains", pattern: "mercado", categoryId: c.Mercado }, prisma);
    const r = await mergeCategories(USER, c.Mercado, c.Feira, prisma);
    expect(r).toMatchObject({ success: true, fromCategory: "Mercado", toCategory: "Feira", transactionsMoved: 1, recurringTransactionsMoved: 1, budgetsMoved: 1, rulesMoved: 1 });
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: r.batchId } })).summary).toBe("Mercado → Feira");
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBe(c.Feira);
    await undoBatch(USER, r.batchId, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).categoryId).toBe(c.Mercado);
  });

  it("moves every rule of the source to the target, also one with the same pattern as a rule the target has under another match type", async () => {
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "feira", categoryId: c.Mercado } });
    const keeper = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "equals", pattern: "feira", categoryId: c.Feira } });
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "equals", pattern: "outra", categoryId: c.Mercado } });
    const r = await mergeCategories(USER, c.Mercado, c.Feira, prisma);
    expect(r.rulesMoved).toBe(2);
    expect(await prisma.categorizationRule.findUniqueOrThrow({ where: { id: keeper.id } })).toMatchObject({ categoryId: c.Feira });
    expect(await prisma.categorizationRule.count({ where: { userId: USER, categoryId: c.Feira } })).toBe(3);
  });

  it("refuses missing, foreign, identical, archived, mismatched and protected categories", async () => {
    await expect(mergeCategories(USER, "nope", c.Feira, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await expect(mergeCategories(USER, c.Mercado, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "category.target_not_found" });
    await expect(mergeCategories(USER, o.categories.Groceries, c.Feira, prisma)).rejects.toMatchObject({ code: "category.not_found" });
    await expect(mergeCategories(USER, c.Mercado, c.Mercado, prisma)).rejects.toMatchObject({ status: 422, code: "category.merge_self" });
    await expect(mergeCategories(USER, c.Mercado, c.Salario, prisma)).rejects.toMatchObject({ code: "category.type_mismatch", params: { from: "expense", to: "income" } });
    await prisma.category.update({ where: { id: c.Feira }, data: { isArchived: true } });
    await expect(mergeCategories(USER, c.Mercado, c.Feira, prisma)).rejects.toMatchObject({ code: "category.merge_into_archived", params: { name: "Feira" } });
    await prisma.category.update({ where: { id: c.Feira }, data: { isArchived: false } });
    const system = await getSystemCategory(USER, "other_system", prisma);
    await expect(mergeCategories(USER, system.id, c.Feira, prisma)).rejects.toMatchObject({ code: "category.system_protected" });
    const defaulted = await prisma.category.create({ data: { userId: USER, name: "Padrao", type: "expense", isDefault: true } });
    await expect(mergeCategories(USER, defaulted.id, c.Feira, prisma)).rejects.toMatchObject({ code: "category.default_protected", message: "Cannot merge from a default category" });
    const flagged = await prisma.category.create({ data: { userId: USER, name: "Sistema", type: "expense", isSystem: true } });
    await expect(mergeCategories(USER, flagged.id, c.Feira, prisma)).rejects.toMatchObject({ message: "Cannot merge from a system category" });
    expect(await prisma.category.count({ where: { id: c.Mercado } })).toBe(1);
  });

  it("refuses a merge when the target already has a budget in the same slot", async () => {
    await createBudget(USER, { categoryId: c.Mercado, amount: 100, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { categoryId: c.Feira, amount: 50, effectiveFrom: "2026-01" }, prisma);
    await expect(mergeCategories(USER, c.Mercado, c.Feira, prisma)).rejects.toMatchObject({ status: 409, code: "category.reassign_budget_clash" });
  });
});

describe("findUncategorized", () => {
  it("lists income and expense entries with no category or an archived one, newest first, with a total", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 1, date: "2026-09-01", description: "Sem" }, prisma, { skipRules: true });
    await createEntry(USER, { kind: "income", accountId: f.pjChecking, amount: 2, date: "2026-09-03", description: "Sem PJ" }, prisma, { skipRules: true });
    const archived = await spend(c.Lazer, 3, "2026-09-02", "Arquivada");
    await prisma.category.update({ where: { id: c.Lazer }, data: { isArchived: true } });
    await spend(c.Mercado, 4, "2026-09-04", "Categorizada");
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 5, date: "2026-09-05" }, prisma);
    const trashed = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 6, date: "2026-09-06", description: "Lixo" }, prisma, { skipRules: true });
    await softDeleteEntries(USER, trashed.entryIds, prisma);

    const all = await findUncategorized(USER, prisma);
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.description)).toEqual(["Sem PJ", "Arquivada", "Sem"]);
    expect(all.rows[1]).toMatchObject({ id: archived.entryIds[0], category: { name: "Lazer", isArchived: true }, entity: { name: "PF", kind: "personal" }, account: { id: f.pfChecking } });
    expect(all.rows[0].category).toBeNull();

    const pj = await findUncategorized(USER, prisma, { entityId: f.pjId });
    expect(pj.rows.map((r) => r.description)).toEqual(["Sem PJ"]);
    const limited = await findUncategorized(USER, prisma, { limit: 1 });
    expect([limited.total, limited.rows.length]).toEqual([3, 1]);
    expect((await findUncategorized(OTHER, prisma)).total).toBe(0);
  });

  it("serializes a category for the API", async () => {
    const row = await prisma.category.findUniqueOrThrow({ where: { id: c.Mercado } });
    expect(serializeCategory(row)).toEqual({ id: c.Mercado, name: "Mercado", type: "expense", color: null, icon: null, systemKey: null, isDefault: false, isSystem: false, isArchived: false });
  });
});
