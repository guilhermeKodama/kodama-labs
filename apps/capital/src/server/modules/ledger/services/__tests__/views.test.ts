import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { viewConfigSchema } from "../../contracts";
import { createView, deleteView, duplicateView, listViews, reorderViews, updateView } from "../views";

const USER = "test-user-ledger-views-001";

beforeAll(async () => {
  await createLedgerFixture(prisma, USER);
});
afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("saved views", () => {
  it("creates the built-in view and protects it", async () => {
    const [all] = await listViews(USER, prisma);
    expect(all).toMatchObject({ name: "Todas", isBuiltin: true, builtinKey: "all" });
    await expect(deleteView(USER, all.id, prisma)).rejects.toThrow(/cannot be deleted/);
    await expect(updateView(USER, all.id, { name: "Outra" }, prisma)).rejects.toThrow(/cannot be renamed/);
  });

  it("names the built-in view in the user's locale, once", async () => {
    const EN = "test-user-ledger-views-en-001";
    await prisma.user.deleteMany({ where: { id: EN } });
    await prisma.user.create({ data: { id: EN, email: `${EN}@example.com`, passwordHash: "x", name: EN, locale: "en" } });
    try {
      const [all] = await listViews(EN, prisma);
      expect(all).toMatchObject({ name: "All", isBuiltin: true, builtinKey: "all" });
      await prisma.user.update({ where: { id: EN }, data: { locale: "pt-BR" } });
      expect((await listViews(EN, prisma)).map((v) => v.name)).toEqual(["All"]);
    } finally {
      await prisma.user.deleteMany({ where: { id: EN } });
    }
  });

  it("keeps display preferences on the built-in view but never its filters", async () => {
    const [all] = await listViews(USER, prisma);
    const config = viewConfigSchema.parse({
      layout: "pivot",
      groupBy: [{ field: "categoryId" }],
      filters: [{ field: "kind", op: "in", values: ["expense"] }],
      search: "mercado",
    });
    const updated = await updateView(USER, all.id, { config }, prisma);
    expect(updated.config.layout).toBe("pivot");
    expect(updated.config.groupBy).toEqual([{ field: "categoryId" }]);
    expect(updated.config.filters).toEqual([]);
    expect(updated.config.search).toBeUndefined();
  });

  it("auto-saves user views, duplicates, reorders and deletes them", async () => {
    const config = viewConfigSchema.parse({ filters: [{ field: "isRecurring", op: "in", values: [true] }] });
    const v = await createView(USER, { name: "Assinaturas", dataset: "ledger", isFavorite: true, config }, prisma);
    const saved = await updateView(USER, v.id, { config: { ...v.config, period: { preset: "this_month", offset: -1 } } }, prisma);
    expect(saved.config.period).toEqual({ preset: "this_month", offset: -1 });
    expect(saved.config.filters).toHaveLength(1);
    const copy = await duplicateView(USER, v.id, prisma);
    expect(copy.name).toBe("Assinaturas (cópia)");
    const views = await listViews(USER, prisma);
    const reordered = await reorderViews(USER, [copy.id, ...views.filter((x) => x.id !== copy.id).map((x) => x.id)], prisma);
    expect(reordered[0].id).toBe(copy.id);
    await deleteView(USER, copy.id, prisma);
    expect((await listViews(USER, prisma)).some((x) => x.id === copy.id)).toBe(false);
  });
});
