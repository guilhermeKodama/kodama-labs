import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import {
  SYSTEM_CATEGORY_DEFINITIONS,
  ensureSystemCategories,
  getSystemCategory,
} from "../system-categories";
import { localizeSystemCategories } from "../localize-system-categories";

const db = prisma;
const TEST_USER_ID = "test-user-system-categories-001";
const PT_USER_ID = "test-user-system-categories-ptbr-001";

async function resetUser(id: string, locale: string) {
  await db.category.deleteMany({ where: { userId: id } });
  await db.user.deleteMany({ where: { id } });
  await db.user.create({
    data: {
      id,
      email: `${id}@example.com`,
      passwordHash: "test-hash",
      name: "System Categories",
      baseCurrency: "BRL",
      locale,
    },
  });
}

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [TEST_USER_ID, PT_USER_ID] } } });
});

// An English-speaking user: the catalog's own names, which legacy rows are matched by.
describe("system category catalog", () => {
  beforeEach(async () => {
    await resetUser(TEST_USER_ID, "en");
  });

  it("does not recreate an English category after it was renamed", async () => {
    await ensureSystemCategories(TEST_USER_ID, db);
    const creditCard = await db.category.findFirst({
      where: { userId: TEST_USER_ID, systemKey: "credit_card" },
    });
    await db.category.update({
      where: { id: creditCard!.id },
      data: { name: "Cartão de Crédito" },
    });

    await ensureSystemCategories(TEST_USER_ID, db);

    const rows = await db.category.findMany({
      where: { userId: TEST_USER_ID, systemKey: "credit_card" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Cartão de Crédito");
    const english = await db.category.findFirst({
      where: { userId: TEST_USER_ID, name: "Credit Card", type: "expense" },
    });
    expect(english).toBeNull();
  });

  it("treats travel_system as an alias of travel_default and does not create a second Travel", async () => {
    await ensureSystemCategories(TEST_USER_ID, db);
    const canonical = await getSystemCategory(TEST_USER_ID, "travel_default", db);
    const alias = await getSystemCategory(TEST_USER_ID, "travel_system", db);

    expect(alias.id).toBe(canonical.id);
    expect(alias.systemKey).toBe("travel_default");

    const travels = await db.category.findMany({
      where: { userId: TEST_USER_ID, name: "Travel", type: "expense" },
    });
    expect(travels).toHaveLength(1);
    const keyedAsSystem = await db.category.findFirst({
      where: { userId: TEST_USER_ID, systemKey: "travel_system" },
    });
    expect(keyedAsSystem).toBeNull();
  });

  it("returns the existing row on a name unique conflict and does not steal its systemKey", async () => {
    const userOwned = await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Credit Card",
        type: "expense",
        isDefault: false,
        isSystem: false,
        systemKey: null,
      },
    });

    const resolved = await getSystemCategory(TEST_USER_ID, "credit_card", db);

    expect(resolved.id).toBe(userOwned.id);
    const reread = await db.category.findUnique({ where: { id: userOwned.id } });
    expect(reread?.systemKey).toBeNull();
  });

  it("does not overwrite a systemKey that already belongs to the conflicting row", async () => {
    const groceries = await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Credit Card",
        type: "expense",
        isDefault: true,
        isSystem: true,
        systemKey: "groceries",
      },
    });

    const resolved = await getSystemCategory(TEST_USER_ID, "credit_card", db);

    expect(resolved.id).toBe(groceries.id);
    const reread = await db.category.findUnique({ where: { id: groceries.id } });
    expect(reread?.systemKey).toBe("groceries");
  });

  it("self-heals a flagged row whose name matches case-insensitively", async () => {
    const legacy = await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "credit card",
        type: "expense",
        isDefault: true,
        isSystem: true,
        systemKey: null,
      },
    });

    const resolved = await getSystemCategory(TEST_USER_ID, "credit_card", db);

    expect(resolved.id).toBe(legacy.id);
    expect(resolved.systemKey).toBe("credit_card");
    const count = await db.category.count({
      where: { userId: TEST_USER_ID, type: "expense", name: { equals: "credit card", mode: "insensitive" } },
    });
    expect(count).toBe(1);
  });

  it("keeps a user-owned Groceries inside a transaction and commits", async () => {
    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Groceries",
        type: "expense",
        isDefault: false,
        isSystem: false,
        systemKey: null,
      },
    });

    await db.$transaction(async (tx) => {
      await ensureSystemCategories(TEST_USER_ID, tx);
      const groceries = await getSystemCategory(TEST_USER_ID, "groceries", tx);
      expect(groceries.name).toBe("Groceries");
      expect(groceries.systemKey).toBeNull();
    });

    const groceries = await db.category.findMany({
      where: { userId: TEST_USER_ID, name: "Groceries", type: "expense" },
    });
    expect(groceries).toHaveLength(1);
    expect(groceries[0].systemKey).toBeNull();
    const creditCard = await db.category.findFirst({
      where: { userId: TEST_USER_ID, systemKey: "credit_card" },
    });
    expect(creditCard).not.toBeNull();
  });

  it("ensures the catalog inside a transaction", async () => {
    await db.$transaction(async (tx) => {
      await ensureSystemCategories(TEST_USER_ID, tx);
      const card = await getSystemCategory(TEST_USER_ID, "credit_card", tx);
      expect(card.name).toBe("Credit Card");
      expect(card.systemKey).toBe("credit_card");
    });

    const count = await db.category.count({ where: { userId: TEST_USER_ID } });
    expect(count).toBe(SYSTEM_CATEGORY_DEFINITIONS.length);
  });

  it("resolves both Travel keys inside a transaction without a second Travel", async () => {
    await db.$transaction(async (tx) => {
      await ensureSystemCategories(TEST_USER_ID, tx);
      const canonical = await getSystemCategory(TEST_USER_ID, "travel_default", tx);
      const alias = await getSystemCategory(TEST_USER_ID, "travel_system", tx);
      expect(alias.id).toBe(canonical.id);
      expect(canonical.systemKey).toBe("travel_default");
    });

    const travels = await db.category.findMany({
      where: { userId: TEST_USER_ID, name: "Travel", type: "expense" },
    });
    expect(travels).toHaveLength(1);
  });

  it("accepts a migration travel_system row as travel_default and does not insert another", async () => {
    const legacy = await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Travel",
        type: "expense",
        isDefault: true,
        isSystem: true,
        systemKey: "travel_system",
      },
    });

    await db.$transaction(async (tx) => {
      await ensureSystemCategories(TEST_USER_ID, tx);
      const canonical = await getSystemCategory(TEST_USER_ID, "travel_default", tx);
      const alias = await getSystemCategory(TEST_USER_ID, "travel_system", tx);
      expect(canonical.id).toBe(legacy.id);
      expect(alias.id).toBe(legacy.id);
      expect(canonical.systemKey).toBe("travel_system");
    });

    const travels = await db.category.findMany({
      where: {
        userId: TEST_USER_ID,
        OR: [
          { name: "Travel", type: "expense" },
          { systemKey: { in: ["travel_default", "travel_system"] } },
        ],
      },
    });
    expect(travels).toHaveLength(1);
    expect(travels[0].systemKey).toBe("travel_system");
  });

  it("resolves an archived system category without unarchiving it", async () => {
    const created = await getSystemCategory(TEST_USER_ID, "credit_card", db);
    await db.category.update({
      where: { id: created.id },
      data: { isArchived: true },
    });

    const resolved = await getSystemCategory(TEST_USER_ID, "credit_card", db);

    expect(resolved.id).toBe(created.id);
    expect(resolved.isArchived).toBe(true);
    const reread = await db.category.findUnique({ where: { id: created.id } });
    expect(reread?.isArchived).toBe(true);
  });
});

describe("system category names in the user's locale", () => {
  beforeEach(async () => {
    await resetUser(PT_USER_ID, "pt-BR");
  });

  it("names new system categories in the user's locale", async () => {
    await ensureSystemCategories(PT_USER_ID, db);
    expect((await getSystemCategory(PT_USER_ID, "groceries", db)).name).toBe("Mercado");
    expect(await getSystemCategory(PT_USER_ID, "travel_system", db)).toMatchObject({ name: "Viagens", systemKey: "travel_default" });
    expect(await db.category.count({ where: { userId: PT_USER_ID } })).toBe(SYSTEM_CATEGORY_DEFINITIONS.length);
    expect(await db.category.count({ where: { userId: PT_USER_ID, name: "Groceries" } })).toBe(0);
  });

  it("still self-heals a legacy English row and keeps its name", async () => {
    const legacy = await db.category.create({
      data: { userId: PT_USER_ID, name: "Groceries", type: "expense", isDefault: true, isSystem: true, systemKey: null },
    });
    const resolved = await getSystemCategory(PT_USER_ID, "groceries", db);
    expect(resolved).toMatchObject({ id: legacy.id, name: "Groceries", systemKey: "groceries" });
    expect(await db.category.count({ where: { userId: PT_USER_ID, name: "Mercado" } })).toBe(0);
  });

  it("returns a user-owned category that already has the localized name, without keying it", async () => {
    const owned = await db.category.create({ data: { userId: PT_USER_ID, name: "Mercado", type: "expense" } });
    const resolved = await getSystemCategory(PT_USER_ID, "groceries", db);
    expect(resolved.id).toBe(owned.id);
    expect(resolved.systemKey).toBeNull();
  });

  it("localizes rows still named in English, keeps renamed ones and skips taken names", async () => {
    const create = (name: string, systemKey: string | null, type: "income" | "expense" = "expense") =>
      db.category.create({ data: { userId: PT_USER_ID, name, type, systemKey, isDefault: systemKey != null, isSystem: systemKey != null } });
    const groceries = await create("Groceries", "groceries");
    const travel = await create("Travel", "travel_system");
    const salary = await create("Salary", "salary", "income");
    const renamed = await create("Meu cartão", "credit_card");
    const taxes = await create("Taxes", "taxes");
    await create("impostos", null);

    const dry = await localizeSystemCategories(db, { userId: PT_USER_ID, dryRun: true });
    expect(dry.renamed.map((r) => [r.id, r.to]).sort()).toEqual(
      [
        [groceries.id, "Mercado"],
        [travel.id, "Viagens"],
        [salary.id, "Salário"],
      ].sort()
    );
    expect(dry.conflicts).toEqual([{ id: taxes.id, userId: PT_USER_ID, name: "Taxes", wanted: "Impostos" }]);
    expect((await db.category.findUniqueOrThrow({ where: { id: groceries.id } })).name).toBe("Groceries");

    const run = await localizeSystemCategories(db, { userId: PT_USER_ID });
    expect(run.renamed).toHaveLength(3);
    const names = await db.category.findMany({ where: { id: { in: [groceries.id, travel.id, salary.id, renamed.id, taxes.id] } } });
    expect(Object.fromEntries(names.map((c) => [c.id, c.name]))).toEqual({
      [groceries.id]: "Mercado",
      [travel.id]: "Viagens",
      [salary.id]: "Salário",
      [renamed.id]: "Meu cartão",
      [taxes.id]: "Taxes",
    });
    expect((await localizeSystemCategories(db, { userId: PT_USER_ID })).renamed).toEqual([]);
  });

  it("leaves an English-speaking user's categories alone", async () => {
    await resetUser(TEST_USER_ID, "en");
    await ensureSystemCategories(TEST_USER_ID, db);
    const result = await localizeSystemCategories(db, { userId: TEST_USER_ID });
    expect(result).toEqual({ renamed: [], conflicts: [] });
  });
});
