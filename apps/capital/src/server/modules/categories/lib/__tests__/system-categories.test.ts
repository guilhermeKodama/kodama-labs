import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import {
  ensureSystemCategories,
  getSystemCategory,
} from "../system-categories";

const db = prisma;
const TEST_USER_ID = "test-user-system-categories-001";

describe("system category catalog", () => {
  beforeEach(async () => {
    await db.category.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.user.deleteMany({ where: { id: TEST_USER_ID } });
    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "system-categories@example.com",
        passwordHash: "test-hash",
        name: "System Categories",
        baseCurrency: "BRL",
      },
    });
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
});
