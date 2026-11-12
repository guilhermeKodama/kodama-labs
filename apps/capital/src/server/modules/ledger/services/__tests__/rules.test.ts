import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The default categorizer of suggestCategory is Claude; nothing here reaches the network.
const claude = vi.hoisted(() => ({ categorizeStatementTransactions: vi.fn() }));
vi.mock("@capital/server/lib/claude", () => claude);

import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { undoBatch, type MutationRecordInput } from "../mutations";
import {
  createRule,
  deleteRule,
  learnRule,
  loadRuleMatcher,
  recordRuleHits,
  suggestCategory,
  testRules,
  updateRule,
} from "../rules";

const USER = "test-user-ledger-rules-001";
const OTHER = "test-user-ledger-rules-002";
let f: LedgerFixture;
let o: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Mercado", type: "expense" },
      { name: "Transporte", type: "expense" },
      { name: "Salario", type: "income" },
    ],
  });
  o = await createLedgerFixture(prisma, OTHER);
  claude.categorizeStatementTransactions.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const rawRule = (matchType: string, pattern: string, categoryId: string, entityId: string | null = null) =>
  prisma.categorizationRule.create({ data: { userId: USER, matchType, pattern, categoryId, entityId } });

describe("loadRuleMatcher", () => {
  it("prefers equals over contains over regex, and an entity's own rule over a global one", async () => {
    await rawRule("regex", "^uber", f.categories.Mercado);
    await rawRule("contains", "uber", f.categories.Transporte);
    expect(((await loadRuleMatcher(USER, prisma)).match("Uber trip"))?.matchType).toBe("contains");
    await rawRule("equals", "uber trip", f.categories.Mercado);
    expect(((await loadRuleMatcher(USER, prisma)).match("UBER TRIP"))?.matchType).toBe("equals");

    await rawRule("contains", "ifood", f.categories.Mercado);
    const own = await rawRule("contains", "ifood pedido", f.categories.Transporte, f.pjId);
    const matcher = await loadRuleMatcher(USER, prisma);
    expect(matcher.match("iFood pedido 7", f.pjId)?.id).toBe(own.id);
    // The entity's rule does not apply to another entity, which falls back to the global one.
    expect(matcher.match("iFood pedido 7", f.pfId)?.categoryId).toBe(f.categories.Mercado);
  });

  it("applies a rule limited to an entity only to that entity, and a global rule to any", async () => {
    await rawRule("contains", "taxi", f.categories.Transporte, f.pjId);
    const matcher = await loadRuleMatcher(USER, prisma);
    expect(matcher.match("Taxi 99", f.pjId)?.categoryId).toBe(f.categories.Transporte);
    expect(matcher.match("Taxi 99", f.pfId)).toBeNull();
    // Without an entity to compare with, the rule is not excluded.
    expect(matcher.match("Taxi 99")?.categoryId).toBe(f.categories.Transporte);
    expect(matcher.match("Padaria")).toBeNull();
  });

  it("skips rules whose category is archived, and ignores rules of unknown type or with a broken regex", async () => {
    await rawRule("regex", "(unclosed", f.categories.Mercado);
    await rawRule("glob", "padaria*", f.categories.Mercado);
    await rawRule("wild", "loja*", f.categories.Mercado);
    await rawRule("exotic", "x", f.categories.Mercado);
    await rawRule("contains", "arquivada", f.categories.Transporte);
    await prisma.category.update({ where: { id: f.categories.Transporte }, data: { isArchived: true } });
    const matcher = await loadRuleMatcher(USER, prisma);
    expect(matcher.match("(unclosed padaria")).toBeNull();
    expect(matcher.match("padaria*")).toBeNull();
    expect(matcher.match("loja arquivada")).toBeNull();
  });

  it("matches a regex case-insensitively against the raw description", async () => {
    await rawRule("regex", "^pix\\s+\\d+$", f.categories.Mercado);
    const matcher = await loadRuleMatcher(USER, prisma);
    expect(matcher.match("PIX 123")?.matchType).toBe("regex");
    expect(matcher.match("pix abc")).toBeNull();
  });
});

describe("recordRuleHits", () => {
  it("adds one hit per occurrence of the id and stamps the last hit", async () => {
    const a = await rawRule("contains", "a", f.categories.Mercado);
    const b = await rawRule("contains", "b", f.categories.Mercado);
    await recordRuleHits([a.id, a.id, b.id], prisma);
    const rows = await prisma.categorizationRule.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.find((r) => r.id === a.id)).toMatchObject({ hitCount: 2 });
    expect(rows.find((r) => r.id === b.id)).toMatchObject({ hitCount: 1 });
    expect(rows.every((r) => r.lastHitAt instanceof Date)).toBe(true);
    await recordRuleHits([], prisma);
  });
});

describe("learnRule", () => {
  it("creates an equals rule on the normalized description, then moves it", async () => {
    const created = await learnRule(USER, "  IFOOD *Restaurante ", f.categories.Mercado, "manual", prisma);
    expect(created).toMatchObject({ matchType: "equals", pattern: "ifood *restaurante", categoryId: f.categories.Mercado, source: "manual" });
    const moved = await learnRule(USER, "ifood *restaurante", f.categories.Transporte, "ai", prisma);
    expect(moved?.id).toBe(created?.id);
    expect(moved).toMatchObject({ categoryId: f.categories.Transporte, source: "ai" });
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(1);
  });

  it("learns nothing from a description that normalizes to nothing", async () => {
    expect(await learnRule(USER, "   ", f.categories.Mercado, "manual", prisma)).toBeNull();
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
  });

  it("collects a record only when the rule is new or changed", async () => {
    const collect: MutationRecordInput[] = [];
    await learnRule(USER, "Padaria", f.categories.Mercado, "bulk", prisma, { collect });
    expect(collect).toHaveLength(1);
    expect(collect[0]).toMatchObject({ model: "CategorizationRule", before: null });
    await learnRule(USER, "Padaria", f.categories.Mercado, "bulk", prisma, { collect });
    expect(collect).toHaveLength(1); // same category and source: nothing to undo
    await learnRule(USER, "Padaria", f.categories.Mercado, "manual", prisma, { collect });
    expect(collect).toHaveLength(2); // same category, other source
    expect(collect[1].before).toMatchObject({ source: "bulk" });
    await learnRule(USER, "Padaria", f.categories.Transporte, "manual", prisma, { collect });
    expect(collect).toHaveLength(3); // other category
  });
});

describe("createRule, updateRule, deleteRule", () => {
  it("creates a rule in one undoable batch, normalizing an equals pattern", async () => {
    const r = await createRule(USER, { matchType: "equals", pattern: "  Spotify BR ", categoryId: f.categories.Mercado, entityId: f.pfId }, prisma);
    expect(r).toMatchObject({ pattern: "spotify br", source: "manual", entityId: f.pfId });
    await undoBatch(USER, r.batchId, prisma);
    expect(await prisma.categorizationRule.count({ where: { id: r.id } })).toBe(0);
  });

  it("keeps contains and regex patterns as typed, and refuses a regex that does not compile", async () => {
    const c = await createRule(USER, { matchType: "contains", pattern: "Uber", categoryId: f.categories.Transporte }, prisma);
    expect(c.pattern).toBe("Uber");
    await expect(createRule(USER, { matchType: "regex", pattern: "(oops", categoryId: f.categories.Transporte }, prisma)).rejects.toMatchObject({ status: 422, code: "rule.invalid_regex" });
  });

  it("refuses a category or entity that is missing, someone else's or archived", async () => {
    await expect(createRule(USER, { matchType: "contains", pattern: "x", categoryId: "nope" }, prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await expect(createRule(USER, { matchType: "contains", pattern: "x", categoryId: o.categories.Groceries }, prisma)).rejects.toMatchObject({ code: "category.not_found" });
    await prisma.category.update({ where: { id: f.categories.Mercado }, data: { isArchived: true } });
    await expect(createRule(USER, { matchType: "contains", pattern: "x", categoryId: f.categories.Mercado }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "category.archived",
      params: { name: "Mercado" },
    });
    await expect(createRule(USER, { matchType: "contains", pattern: "x", categoryId: f.categories.Transporte, entityId: o.pfId }, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
  });

  it("updates the fields in the patch and re-validates the pattern against the match type", async () => {
    const r = await createRule(USER, { matchType: "contains", pattern: "Uber", categoryId: f.categories.Mercado }, prisma);
    const toCategory = await updateRule(USER, r.id, { categoryId: f.categories.Transporte, entityId: f.pjId }, prisma);
    expect(toCategory).toMatchObject({ categoryId: f.categories.Transporte, entityId: f.pjId, pattern: "Uber", matchType: "contains" });

    // Turning the match into equals normalizes the stored pattern.
    const toEquals = await updateRule(USER, r.id, { matchType: "equals" }, prisma);
    expect(toEquals).toMatchObject({ matchType: "equals", pattern: "uber" });
    await expect(updateRule(USER, r.id, { matchType: "regex", pattern: "[" }, prisma)).rejects.toMatchObject({ status: 422, code: "rule.invalid_regex" });
    // Only the pattern: validated with the current match type.
    const pattern = await updateRule(USER, r.id, { pattern: "99 Taxi" }, prisma);
    expect(pattern.pattern).toBe("99 taxi");

    await undoBatch(USER, pattern.batchId, prisma);
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: r.id } })).pattern).toBe("uber");
  });

  it("refuses an update to a missing rule, a stranger's category or entity", async () => {
    const r = await createRule(USER, { matchType: "contains", pattern: "Uber", categoryId: f.categories.Mercado }, prisma);
    await expect(updateRule(USER, "nope", { pattern: "x" }, prisma)).rejects.toMatchObject({ status: 404, code: "rule.not_found" });
    await expect(updateRule(OTHER, r.id, { pattern: "x" }, prisma)).rejects.toMatchObject({ code: "rule.not_found" });
    await expect(updateRule(USER, r.id, { categoryId: o.categories.Groceries }, prisma)).rejects.toMatchObject({ code: "category.not_found" });
    await expect(updateRule(USER, r.id, { entityId: o.pfId }, prisma)).rejects.toMatchObject({ code: "entity.not_found" });
  });

  it("deletes a rule and undo brings it back under its id", async () => {
    const r = await createRule(USER, { matchType: "contains", pattern: "Uber", categoryId: f.categories.Mercado }, prisma);
    const d = await deleteRule(USER, r.id, prisma);
    expect(await prisma.categorizationRule.count({ where: { id: r.id } })).toBe(0);
    await undoBatch(USER, d.batchId, prisma);
    expect(await prisma.categorizationRule.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ pattern: "Uber" });
    await expect(deleteRule(USER, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "rule.not_found" });
    await expect(deleteRule(OTHER, r.id, prisma)).rejects.toMatchObject({ status: 404, code: "rule.not_found" });
  });
});

describe("testRules", () => {
  it("says nothing matches, or which rule, category and hit count", async () => {
    expect(await testRules(USER, "Padaria", prisma)).toEqual({ rule: null, category: null, hitCount: 0 });
    const rule = await rawRule("contains", "padaria", f.categories.Mercado);
    const hit = await testRules(USER, "Padaria Real", prisma);
    expect(hit.rule?.id).toBe(rule.id);
    expect(hit.category?.name).toBe("Mercado");
  });
});

describe("suggestCategory", () => {
  it("suggests nothing for a blank description", async () => {
    expect(await suggestCategory(USER, { description: "   " }, prisma)).toEqual({ source: null, categoryId: null, category: null, rule: null, count: 0 });
  });

  it("skips a matching rule whose category was archived, and falls through to history", async () => {
    // loadRuleMatcher already drops archived categories, so this reaches history with no past entries.
    await rawRule("contains", "padaria", f.categories.Mercado);
    await prisma.category.update({ where: { id: f.categories.Mercado }, data: { isArchived: true } });
    expect((await suggestCategory(USER, { description: "Padaria" }, prisma)).source).toBeNull();
  });

  it("finds no history for a description that is only an installment suffix", async () => {
    expect((await suggestCategory(USER, { description: "(1/3)" }, prisma)).source).toBeNull();
  });

  it("does not ask the AI without a key, and asks the default categorizer when there is one", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await suggestCategory(USER, { description: "Loja Nova", ai: true }, prisma)).source).toBeNull();
    expect(claude.categorizeStatementTransactions).not.toHaveBeenCalled();

    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    claude.categorizeStatementTransactions.mockResolvedValueOnce([{ index: 0, category: "Transporte" }]);
    const s = await suggestCategory(USER, { description: "Loja Nova", ai: true }, prisma);
    expect(s).toMatchObject({ source: "ai", categoryId: f.categories.Transporte, count: 0, rule: null });
    expect(claude.categorizeStatementTransactions).toHaveBeenCalledTimes(1);
    const [rows, names, type] = claude.categorizeStatementTransactions.mock.calls[0];
    expect(rows).toEqual([{ index: 0, description: "Loja Nova", amount: 0 }]);
    expect(names).toEqual(expect.arrayContaining(["Mercado", "Transporte"]));
    expect(type).toBe("expense");
  });

  it("ignores an AI answer naming a category the user does not have, and an empty answer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    claude.categorizeStatementTransactions.mockResolvedValueOnce([{ index: 0, category: "Inventada" }]);
    expect((await suggestCategory(USER, { description: "Loja Nova", ai: true }, prisma)).source).toBeNull();
    claude.categorizeStatementTransactions.mockResolvedValueOnce([]);
    expect((await suggestCategory(USER, { description: "Loja Nova", ai: true, kind: "income" }, prisma)).source).toBeNull();
    expect(claude.categorizeStatementTransactions.mock.calls[1][2]).toBe("income");
  });
});
