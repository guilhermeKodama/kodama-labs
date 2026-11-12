import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { convertIncomeToDividend } from "../../../investments/services/dividends";
import { createHolding } from "../../../investments/services/portfolio";
import {
  archivedCategoryNameSet,
  findOrphanTransactions,
  formatCategoryValidationError,
  matchCategoryName,
  rejectArchivedAssignment,
  validateCategory,
  type CategoryNameMatch,
} from "../category-validation";

const cats = [
  { name: "Groceries", type: "expense" as const },
  { name: "Restaurants", type: "expense" as const },
  { name: "Salary", type: "income" as const },
  { name: "Old Food", type: "expense" as const, isArchived: true },
];

describe("matchCategoryName", () => {
  it("accepts the exact stored name", () => {
    expect(matchCategoryName("Groceries", cats, undefined)).toEqual({
      valid: true,
      archived: false,
      suggestions: [],
      canonicalName: "Groceries",
      validNames: ["Groceries", "Restaurants", "Salary"],
    });
  });

  it("trims the input and accepts a different case, answering the stored spelling", () => {
    expect(matchCategoryName("  groceries ", cats, undefined)).toMatchObject({ valid: true, canonicalName: "Groceries" });
    expect(matchCategoryName("SALARY", cats, "income")).toMatchObject({ valid: true, canonicalName: "Salary" });
  });

  it("recognizes an archived category as known but not assignable, exact or in another case", () => {
    expect(matchCategoryName("Old Food", cats, undefined)).toMatchObject({ valid: false, archived: true, canonicalName: "Old Food" });
    expect(matchCategoryName("old food", cats, undefined)).toMatchObject({ valid: false, archived: true, canonicalName: "Old Food" });
    // Archived names are never offered as valid.
    expect(matchCategoryName("old food", cats, undefined).validNames).not.toContain("Old Food");
  });

  it("only looks at the requested type", () => {
    const wrongType = matchCategoryName("Salary", cats, "expense");
    expect(wrongType).toMatchObject({ valid: false, archived: false });
    expect(wrongType.canonicalName).toBeUndefined();
    expect(wrongType.validNames).toEqual(["Groceries", "Restaurants"]);
  });

  it("suggests the closest visible names for an unknown one", () => {
    const m = matchCategoryName("Grocery", cats, undefined);
    expect(m.valid).toBe(false);
    expect(m.archived).toBe(false);
    expect(m.suggestions[0]).toBe("Groceries");
    expect(m.suggestions).not.toContain("Old Food");
  });

  it("ranks names that start with the input, then names that contain it, then by edit distance, at most three", () => {
    const pool = [
      { name: "Forest Hike", type: "expense" as const },
      { name: "Rent", type: "expense" as const },
      { name: "Restaurants", type: "expense" as const },
      { name: "Taxes", type: "expense" as const },
      { name: "Reserve", type: "expense" as const },
    ];
    expect(matchCategoryName("rest", pool, "expense").suggestions).toEqual(["Restaurants", "Forest Hike", "Rent"]);
  });

  it("ranks the same whatever order the names are listed in", () => {
    const names = ["Forest Hike", "Rent", "Restaurants", "Taxes", "Reserve"];
    const orders = [names, [...names].reverse(), ["Restaurants", "Forest Hike", "Rent", "Taxes", "Reserve"], ["Rent", "Forest Hike", "Restaurants", "Reserve", "Taxes"]];
    for (const order of orders) {
      const pool = order.map((name) => ({ name, type: "expense" as const }));
      const [first, second] = matchCategoryName("rest", pool, "expense").suggestions;
      expect([first, second]).toEqual(["Restaurants", "Forest Hike"]);
    }
  });

  it("has no suggestions when there is nothing to suggest", () => {
    expect(matchCategoryName("Anything", [], undefined)).toEqual({ valid: false, archived: false, suggestions: [], validNames: [] });
  });
});

describe("formatCategoryValidationError", () => {
  const unknown: CategoryNameMatch = { valid: false, archived: false, suggestions: ["Groceries"], validNames: ["Groceries", "Salary"] };

  it("names the archived category and how to fix it", () => {
    const message = formatCategoryValidationError("old food", "expense", { ...unknown, archived: true, canonicalName: "Old Food" });
    expect(message).toBe("Category 'Old Food' is archived and cannot be assigned. Unarchive it or choose a visible category.");
  });

  it("falls back to the typed name when the archived match has no canonical name", () => {
    expect(formatCategoryValidationError("old food", undefined, { ...unknown, archived: true })).toContain("Category 'old food' is archived");
  });

  it("lists the type, the suggestions and the valid names for an unknown category", () => {
    expect(formatCategoryValidationError("Grocry", "expense", unknown)).toBe(
      "Category 'Grocry' not found (type: expense). Did you mean: Groceries? Valid categories: Groceries, Salary.",
    );
  });

  it("leaves out whatever it has nothing to say about", () => {
    expect(formatCategoryValidationError("Zzz", undefined, { valid: false, archived: false, suggestions: [], validNames: [] })).toBe("Category 'Zzz' not found.");
    expect(formatCategoryValidationError("Zzz", "income", { valid: false, archived: false, suggestions: ["A", "B"], validNames: [] })).toBe(
      "Category 'Zzz' not found (type: income). Did you mean: A, B?",
    );
  });
});

describe("with the database", () => {
  const USER = "test-user-mcp-catval-001";
  const OTHER = "test-user-mcp-catval-002";
  let f: LedgerFixture;

  beforeEach(async () => {
    f = await createLedgerFixture(prisma, USER, {
      categories: [
        { name: "Mercado", type: "expense" },
        { name: "Comida Antiga", type: "expense" },
        { name: "Bônus", type: "income" },
      ],
    });
    await prisma.category.update({ where: { id: f.categories["Comida Antiga"] }, data: { isArchived: true } });
    await createLedgerFixture(prisma, OTHER, { categories: [{ name: "Alheia Arquivada", type: "expense" }] });
    await prisma.category.updateMany({ where: { userId: OTHER }, data: { isArchived: true } });
  });

  afterAll(async () => {
    await deleteLedgerFixture(prisma, USER);
    await deleteLedgerFixture(prisma, OTHER);
  });

  describe("rejectArchivedAssignment", () => {
    it("rejects an archived category with the message that tells how to unarchive it", async () => {
      await expect(rejectArchivedAssignment(USER, "Comida Antiga", "expense", prisma)).rejects.toThrow(
        "Category 'Comida Antiga' is archived and cannot be assigned. Unarchive it or choose a visible category.",
      );
      await expect(rejectArchivedAssignment(USER, "comida antiga", undefined, prisma)).rejects.toThrow(/archived/);
    });

    it("lets active categories and names it does not know through", async () => {
      await expect(rejectArchivedAssignment(USER, "Mercado", "expense", prisma)).resolves.toBeUndefined();
      await expect(rejectArchivedAssignment(USER, "Nunca Existiu", "expense", prisma)).resolves.toBeUndefined();
    });

    it("does not look at categories of another type", async () => {
      await expect(rejectArchivedAssignment(USER, "Comida Antiga", "income", prisma)).resolves.toBeUndefined();
    });

    it("allows an update that keeps the category it already had, in any case, but not a switch to another archived one", async () => {
      await expect(rejectArchivedAssignment(USER, "Comida Antiga", "expense", prisma, "comida antiga")).resolves.toBeUndefined();
      await expect(rejectArchivedAssignment(USER, "Comida Antiga", "expense", prisma, "Mercado")).rejects.toThrow(/archived/);
    });

    it("does not see another user's categories", async () => {
      await expect(rejectArchivedAssignment(USER, "Alheia Arquivada", undefined, prisma)).resolves.toBeUndefined();
    });
  });

  describe("archivedCategoryNameSet", () => {
    it("holds the lowercased names of the user's archived categories only", async () => {
      expect(await archivedCategoryNameSet(USER, prisma)).toEqual(new Set(["comida antiga"]));
      expect(await archivedCategoryNameSet(OTHER, prisma)).toEqual(new Set(["alheia arquivada"]));
    });

    it("is empty for a user with none", async () => {
      expect((await archivedCategoryNameSet("test-user-mcp-catval-nobody", prisma)).size).toBe(0);
    });
  });

  describe("validateCategory", () => {
    it("matches against the user's categories, archived ones included", async () => {
      expect(await validateCategory(USER, "mercado", "expense", prisma)).toMatchObject({ valid: true, canonicalName: "Mercado", validNames: ["Mercado"] });
      expect(await validateCategory(USER, "Comida Antiga", undefined, prisma)).toMatchObject({ valid: false, archived: true });
    });

    it("suggests a close visible name for a typo", async () => {
      const m = await validateCategory(USER, "Mercad", "expense", prisma);
      expect(m.valid).toBe(false);
      expect(m.suggestions).toEqual(["Mercado"]);
    });
  });

  describe("findOrphanTransactions", () => {
    const add = (input: { description: string; categoryId?: string; date?: string; kind?: "income" | "expense" }) =>
      createEntry(USER, { kind: input.kind ?? "expense", accountId: f.pfChecking, amount: 10, date: input.date ?? "2026-09-02", description: input.description, categoryId: input.categoryId }, prisma, {
        skipRules: true,
      });

    it("counts entries with no category or an archived one, grouped by category name, newest first", async () => {
      // An entry can only get a category before it is archived, so archive afterwards. A charge is a positive expense.
      const live = await prisma.category.create({ data: { userId: USER, name: "Vai Arquivar", type: "expense" } });
      await add({ description: "sem categoria 1", date: "2026-09-03" });
      await add({ description: "sem categoria 2", date: "2026-09-01", kind: "income" });
      await add({ description: "categoria arquivada", categoryId: live.id, date: "2026-09-02" });
      await add({ description: "categorizada", categoryId: f.categories.Mercado, date: "2026-09-04" });
      await prisma.category.update({ where: { id: live.id }, data: { isArchived: true } });

      const r = await findOrphanTransactions(USER, prisma);

      expect(r.total).toBe(3);
      expect([...r.categories].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: "(none)", count: 2 },
        { name: "Vai Arquivar", count: 1 },
      ]);
      expect(r.transactions.map((t) => t.description)).toEqual(["sem categoria 1", "categoria arquivada", "sem categoria 2"]);
      expect(r.transactions[0]).toMatchObject({ category: null, amount: 10, type: "expense", accountId: f.pfChecking, accountName: "Conta principal", operationId: null });
      expect(r.transactions[1]).toMatchObject({ category: "Vai Arquivar" });
      expect(r.transactions[2]).toMatchObject({ amount: 10, type: "income" });
      expect(r.transactions[0].date).toBe("2026-09-03T12:00:00.000Z");
    });

    it("names the investment operation behind an uncategorized dividend cash leg", async () => {
      const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
      const income = (await add({ description: "PETR4 rendimento", kind: "income" })).entryIds[0];
      const linked = await convertIncomeToDividend(USER, { transactionId: income, holdingId: holding.id, incomeType: "dividend" }, prisma);
      // convert_income_to_dividend files the cash leg under Dividends; take that away again.
      await prisma.ledgerEntry.update({ where: { id: income }, data: { categoryId: null } });

      const r = await findOrphanTransactions(USER, prisma);

      expect(r.transactions.find((t) => t.id === income)).toMatchObject({ category: null, operationId: linked.operationId });
    });

    it("leaves out trashed entries, transfers and other users' entries", async () => {
      const [trashed] = (await add({ description: "na lixeira" })).entryIds;
      await prisma.ledgerEntry.update({ where: { id: trashed }, data: { deletedAt: new Date() } });
      await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 5, date: "2026-09-02", description: "transferência" }, prisma, { skipRules: true });

      expect(await findOrphanTransactions(USER, prisma)).toEqual({ total: 0, categories: [], transactions: [] });
      expect((await findOrphanTransactions(OTHER, prisma)).total).toBe(0);
    });
  });
});
