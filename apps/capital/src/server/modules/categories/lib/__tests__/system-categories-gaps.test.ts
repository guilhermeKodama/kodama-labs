import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@capital/server/lib/prisma";
import { prisma } from "@capital/server/lib/prisma";
import {
  findSystemCategoryDefinition,
  getSystemCategory,
  getSystemCategoryNames,
  resolveSystemKey,
  systemCategoryName,
} from "../system-categories";

const USER = "test-user-system-categories-gaps-001";

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@example.com`, passwordHash: "x", name: USER, locale: "pt-BR" } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("catalog keys", () => {
  it("resolves the Travel alias and leaves other keys alone", () => {
    expect(resolveSystemKey("travel_system")).toBe("travel_default");
    expect(resolveSystemKey("taxes")).toBe("taxes");
    expect(findSystemCategoryDefinition("travel_system")).toMatchObject({ systemKey: "travel_default", name: "Travel" });
    expect(findSystemCategoryDefinition("taxes")).toMatchObject({ type: "expense", isDefault: true });
    expect(findSystemCategoryDefinition("no_such_key")).toBeUndefined();
  });

  it("names a catalog category in each language and refuses a key the catalog does not have", () => {
    expect(systemCategoryName("other_system", "pt-BR")).toBe("Outros");
    expect(systemCategoryName("other_system", "en")).toBe("Other");
    expect(systemCategoryName("travel_system", "en")).toBe(systemCategoryName("travel_default", "en"));
    expect(() => systemCategoryName("no_such_key", "en")).toThrow("Unknown system category key: no_such_key");
  });

  it("throws for an unknown key when resolving a user's category, without touching the database", async () => {
    await expect(getSystemCategory(USER, "no_such_key", prisma)).rejects.toThrow("Unknown system category key: no_such_key");
    expect(await prisma.category.count({ where: { userId: USER } })).toBe(0);
    await expect(getSystemCategoryNames(USER, ["taxes", "no_such_key"], prisma)).rejects.toThrow("Unknown system category key");
  });
});

describe("a flagged row that already has the localized name", () => {
  it("is keyed instead of duplicated, when the catalog row cannot be inserted next to it", async () => {
    // pt-BR "Outros" is not the catalog's English name, so the legacy lookup misses it; the insert
    // then hits its (user, name, type) key and the name match adopts it.
    const mine = await prisma.category.create({ data: { userId: USER, name: "Outros", type: "expense", isDefault: true } });
    const got = await getSystemCategory(USER, "other_system", prisma);
    expect(got.id).toBe(mine.id);
    expect(got.systemKey).toBe("other_system");
    expect(await prisma.category.count({ where: { userId: USER, type: "expense", name: "Outros" } })).toBe(1);
  });

  it("is keyed when it is flagged as a system category", async () => {
    const mine = await prisma.category.create({ data: { userId: USER, name: "Outros", type: "expense", isSystem: true } });
    expect((await getSystemCategory(USER, "other_system", prisma)).systemKey).toBe("other_system");
    expect((await prisma.category.findUniqueOrThrow({ where: { id: mine.id } })).systemKey).toBe("other_system");
  });

  it("leaves a user row alone when its name differs from the catalog name only in case", async () => {
    const mine = await prisma.category.create({ data: { userId: USER, name: "outros", type: "expense" } });
    // Case differs, so the insert succeeds beside it and the keyed row is the new one.
    const got = await getSystemCategory(USER, "other_system", prisma);
    expect(got.id).not.toBe(mine.id);
    expect(got.name).toBe("Outros");
    expect((await prisma.category.findUniqueOrThrow({ where: { id: mine.id } })).systemKey).toBeNull();
  });
});

describe("when the row cannot be found after the insert", () => {
  const nothing = {
    category: {
      findMany: async () => [],
      createMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      update: async () => {
        throw new Error("unexpected update");
      },
    },
    user: { findUnique: async () => ({ locale: "en" }) },
  } as unknown as DbClient;

  it("fails loudly instead of returning nothing", async () => {
    await expect(getSystemCategory(USER, "taxes", nothing)).rejects.toThrow("Failed to resolve system category 'taxes'");
  });
});
