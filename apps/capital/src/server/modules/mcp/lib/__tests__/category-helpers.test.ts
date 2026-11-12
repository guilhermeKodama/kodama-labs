import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { getCategoryBySystemKey, getCategoryNameBySystemKey } from "../category-helpers";

const USER = "test-user-mcp-cathelp-001";

beforeEach(async () => {
  await createLedgerFixture(prisma, USER, { categories: [] });
  // A new system category is named in its owner's locale.
  await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("category helpers", () => {
  it("creates a missing system category on first use and finds the same row afterwards", async () => {
    expect(await prisma.category.count({ where: { userId: USER, systemKey: "groceries" } })).toBe(0);

    const first = await getCategoryBySystemKey(USER, "groceries", prisma);
    const second = await getCategoryBySystemKey(USER, "groceries", prisma);

    expect(first).toMatchObject({ userId: USER, systemKey: "groceries", name: "Groceries", type: "expense", isSystem: true });
    expect(second.id).toBe(first.id);
    expect(await prisma.category.count({ where: { userId: USER, systemKey: "groceries" } })).toBe(1);
  });

  it("answers the current name of the category, which follows a rename", async () => {
    expect(await getCategoryNameBySystemKey(USER, "other_system", prisma)).toBe("Other");

    const row = await getCategoryBySystemKey(USER, "other_system", prisma);
    await prisma.category.update({ where: { id: row.id }, data: { name: "Outros" } });

    expect(await getCategoryNameBySystemKey(USER, "other_system", prisma)).toBe("Outros");
  });

  it("names a new system category in the owner's locale", async () => {
    await prisma.user.update({ where: { id: USER }, data: { locale: "pt-BR" } });
    expect(await getCategoryNameBySystemKey(USER, "groceries", prisma)).toBe("Mercado");
  });

  it("rejects a key the catalog does not know", async () => {
    await expect(getCategoryBySystemKey(USER, "no_such_key", prisma)).rejects.toThrow("Unknown system category key: no_such_key");
    await expect(getCategoryNameBySystemKey(USER, "no_such_key", prisma)).rejects.toThrow("Unknown system category key");
  });
});
