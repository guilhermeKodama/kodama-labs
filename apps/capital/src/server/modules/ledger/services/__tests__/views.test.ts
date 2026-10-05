import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { viewConfigSchema, type ViewConfig } from "../../contracts";
import { ensureDefaultViews, VIEWS_SEED_VERSION } from "../default-views";
import { createView, deleteView, duplicateView, listViews, reorderViews, updateView, viewSelection, type SerializedView } from "../views";

const USER = "test-user-ledger-views-001";
let f: LedgerFixture;

/** The config of a ledger view (fails the test otherwise). */
function ledgerConfig(view: SerializedView): ViewConfig {
  if (view.dataset !== "ledger") throw new Error(`expected a ledger view, got ${view.dataset}`);
  return view.config;
}

const builtin = (views: SerializedView[]) => views.find((v) => v.isBuiltin)!;
const bySeed = (views: SerializedView[], key: string) => views.find((v) => v.seedKey === key);

async function freshUser(id: string, data: { locale?: string } = {}) {
  await prisma.user.deleteMany({ where: { id } });
  await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: "x", name: id, ...data } });
  await prisma.entity.create({ data: { userId: id, kind: "personal", name: "PF" } });
}

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
});
afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("saved views", () => {
  it("creates the built-in view and protects it", async () => {
    const all = builtin(await listViews(USER, prisma));
    expect(all).toMatchObject({ name: "Todas", isBuiltin: true, builtinKey: "all", seedKey: null, dataset: "ledger" });
    await expect(deleteView(USER, all.id, prisma)).rejects.toThrow(/cannot be deleted/);
    await expect(updateView(USER, all.id, { name: "Outra" }, prisma)).rejects.toThrow(/cannot be renamed/);
  });

  it("names the built-in view in the user's locale, once", async () => {
    const EN = "test-user-ledger-views-en-001";
    await freshUser(EN, { locale: "en" });
    try {
      expect(builtin(await listViews(EN, prisma))).toMatchObject({ name: "All", isBuiltin: true, builtinKey: "all" });
      await prisma.user.update({ where: { id: EN }, data: { locale: "pt-BR" } });
      expect(builtin(await listViews(EN, prisma)).name).toBe("All");
    } finally {
      await prisma.user.deleteMany({ where: { id: EN } });
    }
  });

  it("keeps display preferences on the built-in view but never its filters", async () => {
    const all = builtin(await listViews(USER, prisma));
    const config = viewConfigSchema.parse({
      layout: "pivot",
      groupBy: [{ field: "categoryId" }],
      filters: [{ field: "kind", op: "in", values: ["expense"] }],
      search: "mercado",
    });
    const updated = ledgerConfig(await updateView(USER, all.id, { config }, prisma));
    expect(updated.layout).toBe("pivot");
    expect(updated.groupBy).toEqual([{ field: "categoryId" }]);
    expect(updated.filters).toEqual([]);
    expect(updated.search).toBeUndefined();
  });

  it("auto-saves user views, duplicates, reorders and deletes them", async () => {
    const config = viewConfigSchema.parse({ filters: [{ field: "isRecurring", op: "in", values: [true] }] });
    const v = await createView(USER, { name: "Recorrentes", dataset: "ledger", isFavorite: true, config }, prisma);
    const saved = ledgerConfig(await updateView(USER, v.id, { config: { ...ledgerConfig(v), period: { preset: "this_month", offset: -1 } } }, prisma));
    expect(saved.period).toEqual({ preset: "this_month", offset: -1 });
    expect(saved.filters).toHaveLength(1);
    const copy = await duplicateView(USER, v.id, prisma);
    expect(copy.name).toBe("Recorrentes (cópia)");
    expect(ledgerConfig(copy).period).toEqual({ preset: "this_month", offset: -1 });
    const views = await listViews(USER, prisma);
    const reordered = await reorderViews(USER, [copy.id, ...views.filter((x) => x.id !== copy.id).map((x) => x.id)], prisma);
    expect(reordered[0].id).toBe(copy.id);
    await deleteView(USER, copy.id, prisma);
    expect((await listViews(USER, prisma)).some((x) => x.id === copy.id)).toBe(false);
  });

  it("creates a view from the API body with defaults (dataset ledger, the dataset's config)", async () => {
    const v = await createView(
      USER,
      { name: "Importação · extrato.ofx", isFavorite: false, config: { period: { preset: "all" }, filters: [{ field: "importId", op: "in", values: ["imp-1"] }] } },
      prisma
    );
    expect(v).toMatchObject({ dataset: "ledger", isFavorite: false });
    expect(ledgerConfig(v)).toMatchObject({ layout: "table", period: { preset: "all", offset: 0 }, filters: [{ field: "importId", op: "in", values: ["imp-1"] }] });
    await deleteView(USER, v.id, prisma);
  });

  it("duplicates with the config on screen: Todas' temporary filters, a drill", async () => {
    const all = builtin(await listViews(USER, prisma));
    const onScreen = { ...ledgerConfig(all), filters: [{ field: "flowKind", op: "in", values: ["out"] }], search: "uber" };
    const copy = await duplicateView(USER, all.id, prisma, { name: "Saídas", config: onScreen });
    expect(copy).toMatchObject({ name: "Saídas", isBuiltin: false, builtinKey: null, isFavorite: true, dataset: "ledger" });
    expect(ledgerConfig(copy).filters).toEqual([{ field: "flowKind", op: "in", values: ["out"] }]);
    expect(ledgerConfig(copy).search).toBe("uber");
    expect(ledgerConfig(copy).layout).toBe(ledgerConfig(all).layout);
    await expect(duplicateView(USER, all.id, prisma, { config: { layout: "spreadsheet" } })).rejects.toMatchObject({ name: "ZodError" });
    await deleteView(USER, copy.id, prisma);
  });
});

describe("view datasets", () => {
  it("validates each view's config against its dataset", async () => {
    const holdings = await createView(
      USER,
      { name: "Cripto", dataset: "holdings", config: { groupBy: "accountId", filters: [{ field: "allocationClass", values: ["crypto"] }] } },
      prisma
    );
    expect(holdings).toMatchObject({ dataset: "holdings", config: { groupBy: "accountId", layout: "table", filters: [{ field: "allocationClass", op: "in", values: ["crypto"] }] } });
    const patched = await updateView(USER, holdings.id, { config: { ...holdings.config, groupBy: "entityId" } }, prisma);
    expect(patched.config).toMatchObject({ groupBy: "entityId" });
    await expect(updateView(USER, holdings.id, { config: { layout: "pivot" } }, prisma)).rejects.toMatchObject({ name: "ZodError" });
    await expect(createView(USER, { name: "x", dataset: "investment_ops", config: { groupBy: "category" } } as never, prisma)).rejects.toMatchObject({ name: "ZodError" });
    await expect(viewSelection(USER, holdings.id, prisma)).rejects.toMatchObject({ code: "view.not_exportable", status: 422 });
    const copy = await duplicateView(USER, holdings.id, prisma);
    expect(copy).toMatchObject({ dataset: "holdings", config: { groupBy: "entityId" } });
    expect((await listViews(USER, prisma, "holdings")).every((v) => v.dataset === "holdings")).toBe(true);
    await deleteView(USER, copy.id, prisma);
    await deleteView(USER, holdings.id, prisma);
  });
});

describe("default views", () => {
  it("seeds the mockup's views once, PJ filtered by the user's businesses", async () => {
    const views = await listViews(USER, prisma);
    const ledger = views.filter((v) => v.dataset === "ledger" && v.seedKey);
    // The fixture has no system "taxes" category, so no "Impostos PJ".
    expect(ledger.map((v) => [v.seedKey, v.name, v.isFavorite])).toEqual([
      ["pj", "PJ", true],
      ["subs", "Assinaturas", true],
      ["ir", "Dedutíveis IR", true],
      ["cat", "Gastos por categoria", true],
      ["pivot", "Categoria × entidade", false],
      ["board", "Por conta", false],
      ["cal", "Calendário de gastos", false],
      ["trend", "Gastos por mês", true],
      ["flow", "Fluxo do mês", false],
      ["balance", "Saídas acumuladas", false],
    ]);
    expect(ledgerConfig(bySeed(views, "pj")!)).toMatchObject({ filters: [{ field: "entityId", op: "in", values: [f.pjId] }], groupBy: [{ field: "entityId" }, { field: "categoryId" }] });
    expect(ledgerConfig(bySeed(views, "subs")!)).toMatchObject({
      filters: [
        { field: "isRecurring", op: "in", values: [true] },
        { field: "flowKind", op: "in", values: ["out"] },
      ],
      columns: ["date", "description", "entityId", "accountId", "amountBase"],
      calcs: { amountBase: "sum", description: "count" },
    });
    expect(ledgerConfig(bySeed(views, "ir")!).period).toEqual({ preset: "ytd", offset: 0 });
    expect(ledgerConfig(bySeed(views, "trend")!)).toMatchObject({
      layout: "chart",
      chart: { type: "bar" },
      groupBy: [{ field: "date", bucket: "month" }, { field: "entityId" }],
      period: { preset: "last_3m" },
    });
    expect(ledgerConfig(bySeed(views, "flow")!).chart).toMatchObject({ type: "waterfall", top: 8 });
    expect(ledgerConfig(bySeed(views, "balance")!).chart).toMatchObject({ type: "area", cumulative: true });
    expect(ledgerConfig(bySeed(views, "board")!)).toMatchObject({ layout: "board", groupBy: [{ field: "accountId" }] });

    expect(views.filter((v) => v.dataset === "holdings").map((v) => [v.seedKey, v.name, v.config.groupBy])).toEqual([
      ["byClass", "Por classe", "allocationClass"],
      ["byBroker", "Por corretora", "accountId"],
      ["byEntity", "Por entidade", "entityId"],
      ["list", "Lista", "none"],
    ]);
    const ops = views.filter((v) => v.dataset === "investment_ops");
    expect(ops.map((v) => [v.seedKey, v.name])).toEqual([
      ["income12m", "Proventos 12m"],
      ["operations", "Operações"],
    ]);
    expect(ops[0].config).toMatchObject({ layout: "chart", period: { preset: "last_12m" }, groupBy: "month", filters: [{ field: "type", values: ["dividend", "yield_payment"] }] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: USER } })).viewsSeedVersion).toBe(VIEWS_SEED_VERSION);
  });

  it("is idempotent, also under concurrent calls, and never brings back a deleted default", async () => {
    const before = await prisma.savedView.count({ where: { userId: USER } });
    await Promise.all([ensureDefaultViews(USER, prisma), ensureDefaultViews(USER, prisma), listViews(USER, prisma)]);
    expect(await prisma.savedView.count({ where: { userId: USER } })).toBe(before);
    const cal = bySeed(await listViews(USER, prisma), "cal")!;
    await deleteView(USER, cal.id, prisma);
    expect(bySeed(await listViews(USER, prisma), "cal")).toBeUndefined();
    expect(await ensureDefaultViews(USER, prisma)).toEqual([]);
  });

  it("seeds a new user once under concurrency, then the PJ views with the first business, in the user's locale", async () => {
    const NEW = "test-user-ledger-views-seed-001";
    await freshUser(NEW, { locale: "en" });
    try {
      const taxes = await prisma.category.create({ data: { userId: NEW, name: "Taxes", type: "expense", systemKey: "taxes" } });
      const runs = await Promise.all([ensureDefaultViews(NEW, prisma), ensureDefaultViews(NEW, prisma), ensureDefaultViews(NEW, prisma)]);
      expect(runs.filter((r) => r.length).length).toBe(1);
      let views = await listViews(NEW, prisma);
      expect(views.filter((v) => v.seedKey)).toHaveLength(15);
      expect(bySeed(views, "pj")).toBeUndefined();
      expect(bySeed(views, "subs")?.name).toBe("Subscriptions");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: NEW } })).viewsSeedVersion).toBe(1);

      const pj = await prisma.entity.create({ data: { userId: NEW, kind: "business", name: "Kodama LTDA" } });
      views = await listViews(NEW, prisma);
      expect(ledgerConfig(bySeed(views, "pj")!).filters).toEqual([{ field: "entityId", op: "in", values: [pj.id] }]);
      expect(bySeed(views, "taxpj")).toMatchObject({ name: "Business taxes", isFavorite: false });
      expect(ledgerConfig(bySeed(views, "taxpj")!)).toMatchObject({
        filters: [
          { field: "entityId", op: "in", values: [pj.id] },
          { field: "categoryId", op: "in", values: [taxes.id] },
        ],
        period: { preset: "ytd", offset: 0 },
      });
      expect(views.filter((v) => v.seedKey)).toHaveLength(17);
      await deleteView(NEW, bySeed(views, "pj")!.id, prisma);
      await prisma.entity.create({ data: { userId: NEW, kind: "business", name: "Kodama LLC" } });
      expect(bySeed(await listViews(NEW, prisma), "pj")).toBeUndefined();
    } finally {
      await prisma.user.deleteMany({ where: { id: NEW } });
    }
  });
});
