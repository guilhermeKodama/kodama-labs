import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "../entries";
import { createRule, suggestCategory, testRules, type SuggestCategorizer } from "../rules";

const USER = "test-user-s2-rule-suggest-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Restaurantes", type: "expense" },
      { name: "Transporte", type: "expense" },
      { name: "Software", type: "expense" },
      { name: "Receita de serviços", type: "income" },
    ],
  });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const expense = (description: string, categoryId: string | null, accountId = f.pfChecking, date = "2026-09-10") =>
  createEntry(USER, { kind: "expense", accountId, amount: 10, description, date, categoryId }, prisma, { skipRules: true });

describe("rules/test", () => {
  it("matches the way createEntry does for an entity and reports the hit count", async () => {
    const rule = await createRule(USER, { matchType: "contains", pattern: "ifood", categoryId: f.categories.Restaurantes, entityId: f.pjId }, prisma);
    await prisma.categorizationRule.update({ where: { id: rule.id }, data: { hitCount: 23 } });
    expect(await testRules(USER, "IFOOD *Restaurante", prisma, { entityId: f.pfId })).toEqual({ rule: null, category: null, hitCount: 0 });
    const hit = await testRules(USER, "IFOOD *Restaurante", prisma, { entityId: f.pjId });
    expect(hit.hitCount).toBe(23);
    expect(hit.category?.name).toBe("Restaurantes");
  });
});

describe("rules/suggest", () => {
  it("prefers a matching rule", async () => {
    await createRule(USER, { matchType: "contains", pattern: "uber", categoryId: f.categories.Transporte }, prisma);
    await expense("Uber", f.categories.Software);
    const s = await suggestCategory(USER, { description: "Uber trip" }, prisma);
    expect(s).toMatchObject({ source: "rule", categoryId: f.categories.Transporte, category: { name: "Transporte" }, rule: { pattern: "uber", matchType: "contains", hitCount: 0 } });
  });

  it("falls back to the category most used by past entries with the same description, the entity's own first", async () => {
    await expense("Padaria Real", f.categories.Restaurantes);
    await expense("padaria real ", f.categories.Restaurantes, f.pfChecking, "2026-09-11");
    await expense("Padaria Real (2/3)", f.categories.Software);
    await expense("Padaria Real", f.categories.Software, f.pjChecking);
    await expense("Padaria Real", null);

    expect(await suggestCategory(USER, { description: "PADARIA REAL" }, prisma)).toMatchObject({ source: "history", categoryId: f.categories.Restaurantes, count: 2 });
    expect(await suggestCategory(USER, { description: "Padaria Real", entityId: f.pjId }, prisma)).toMatchObject({ source: "history", categoryId: f.categories.Software, count: 1 });
    // Installments count as the purchase they split.
    await expense("Curso Alura (1/3)", f.categories.Software);
    await expense("Curso Alura (2/3)", f.categories.Software);
    expect(await suggestCategory(USER, { description: "curso alura" }, prisma)).toMatchObject({ source: "history", categoryId: f.categories.Software, count: 2 });
    expect(await suggestCategory(USER, { description: "Curso Alura (3/3)" }, prisma)).toMatchObject({ source: "history", count: 2 });
    // Income suggestions only look at income history.
    expect(await suggestCategory(USER, { description: "Padaria Real", kind: "income" }, prisma)).toMatchObject({ source: null, categoryId: null });
  });

  it("skips archived categories in the history", async () => {
    await expense("Locadora", f.categories.Software);
    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    expect((await suggestCategory(USER, { description: "Locadora" }, prisma)).source).toBeNull();
  });

  it("asks the AI only when asked to, and ignores its fallback answer", async () => {
    const categorize = vi.fn<SuggestCategorizer>(async (rows) => rows.map((r) => ({ index: r.index, category: "Software" })));
    expect((await suggestCategory(USER, { description: "Notion Labs" }, prisma, { categorize })).source).toBeNull();
    expect(categorize).not.toHaveBeenCalled();

    const s = await suggestCategory(USER, { description: "Notion Labs", ai: true }, prisma, { categorize });
    expect(s).toMatchObject({ source: "ai", categoryId: f.categories.Software, category: { name: "Software" } });
    expect(categorize.mock.calls[0][1]).toEqual(expect.arrayContaining(["Restaurantes", "Transporte", "Software"]));

    const unsure = vi.fn<SuggestCategorizer>(async (rows, _categories, _type, fallback) => rows.map((r) => ({ index: r.index, category: fallback })));
    expect((await suggestCategory(USER, { description: "Algo estranho", ai: true }, prisma, { categorize: unsure })).source).toBeNull();
  });

  it("checks the entity", async () => {
    await expect(suggestCategory(USER, { description: "x", entityId: "nope" }, prisma)).rejects.toMatchObject({ code: "entity.not_found" });
  });
});
