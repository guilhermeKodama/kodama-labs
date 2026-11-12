import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture } from "@/test/ledger-fixtures";
import { viewConfigSchema, type ViewConfig } from "../../contracts";
import { ensureDefaultViews, migrateBusinessViews } from "../default-views";
import { undoBatch, type MutationRecordInput } from "../mutations";
import {
  createView,
  deleteView,
  duplicateView,
  ensureBuiltinViews,
  listViews,
  nextNewViewName,
  reorderViews,
  serializeView,
  updateView,
  viewSelection,
} from "../views";

const USER = "test-user-ledger-views-branches-001";
const OTHER = "test-user-ledger-views-branches-002";
const BARE = "test-user-ledger-views-branches-003";

beforeEach(async () => {
  await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  await prisma.user.deleteMany({ where: { id: BARE } });
});

afterAll(async () => {
  for (const id of [USER, OTHER, BARE]) await prisma.user.deleteMany({ where: { id } });
});

const ledgerConfig = (view: { dataset: string; config: unknown }) => view.config as ViewConfig;
const config = (overrides: Record<string, unknown> = {}) => viewConfigSchema.parse(overrides);
const lastBatch = () => prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER }, orderBy: { createdAt: "desc" }, include: { records: true } });

describe("serializeView", () => {
  it("reads an unknown dataset as ledger and an unreadable config as the defaults", async () => {
    const row = await prisma.savedView.create({ data: { userId: USER, name: "Estranha", dataset: "bogus", position: 99, config: { layout: "not-a-layout", period: 3 } } });
    const view = serializeView(row);
    expect(view.dataset).toBe("ledger");
    expect(ledgerConfig(view)).toMatchObject({ layout: "table", period: { preset: "this_month", offset: 0 }, filters: [] });
    const empty = await prisma.savedView.create({ data: { userId: USER, name: "Vazia", dataset: "holdings", position: 100, config: Prisma.JsonNull as never } });
    expect(serializeView(empty)).toMatchObject({ dataset: "holdings", config: { layout: "table" } });
  });
});

describe("ensureBuiltinViews", () => {
  const fakeDb = (upsert: () => Promise<unknown>) =>
    ({
      savedView: { findUnique: async () => null, upsert },
      user: { findUnique: async () => ({ locale: "en" }) },
    }) as unknown as DbClient;

  it("creates Todas once, in the user's language", async () => {
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    await ensureBuiltinViews(USER, prisma);
    await ensureBuiltinViews(USER, prisma);
    const rows = await prisma.savedView.findMany({ where: { userId: USER, isBuiltin: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "All", builtinKey: "all", isFavorite: true, position: 0 });
  });

  it("lets the loser of a unique-key race read the view the other request committed", async () => {
    const duplicate = () => Promise.reject(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));
    await expect(ensureBuiltinViews(USER, fakeDb(duplicate))).resolves.toBeUndefined();
  });

  it("rethrows any other failure", async () => {
    const other = () => Promise.reject(new Prisma.PrismaClientKnownRequestError("Connection", { code: "P1001", clientVersion: "test" }));
    await expect(ensureBuiltinViews(USER, fakeDb(other))).rejects.toMatchObject({ code: "P1001" });
    await expect(ensureBuiltinViews(USER, fakeDb(() => Promise.reject(new Error("boom"))))).rejects.toThrow("boom");
  });
});

describe("nextNewViewName", () => {
  it("numbers one past the highest in use, ignoring other names and escaping the base", () => {
    expect(nextNewViewName("Nova view", [])).toBe("Nova view");
    expect(nextNewViewName("Nova view", ["Nova view"])).toBe("Nova view 2");
    expect(nextNewViewName("Nova view", ["Nova view", " Nova view 4 ", "Nova view 2", "Nova view extra", "Outra"])).toBe("Nova view 5");
    expect(nextNewViewName("Vista (1)", ["Vista (1) 3", "Vista 1 9"])).toBe("Vista (1) 4");
  });
});

describe("createView", () => {
  it("names a view without a name per dataset, leaves its creation off the undo log, and puts it last", async () => {
    const first = await createView(USER, { dataset: "ledger", isFavorite: true, config: config() }, prisma);
    const second = await createView(USER, { dataset: "ledger", isFavorite: true, config: config() }, prisma);
    expect([first.name, second.name]).toEqual(["Nova view", "Nova view 2"]);
    expect(first.batchId).toBeNull();
    expect(second.position).toBeGreaterThan(first.position);
    const holdings = await createView(USER, { dataset: "holdings", isFavorite: false, config: {} } as never, prisma);
    expect(holdings.name).toBe("Nova view");
  });

  it("records a named creation, and undo removes the view", async () => {
    const v = await createView(USER, { name: "Mensal", dataset: "ledger", isFavorite: true, config: config() }, prisma);
    expect(v.batchId).not.toBeNull();
    await undoBatch(USER, v.batchId!, prisma);
    expect(await prisma.savedView.count({ where: { id: v.id } })).toBe(0);
  });

  it("hands the record to the caller's batch, or records nothing when asked not to", async () => {
    const collect: MutationRecordInput[] = [];
    const collected = await createView(USER, { name: "Importacao", dataset: "ledger", isFavorite: false, config: config() }, prisma, { collect });
    expect(collected.batchId).toBeNull();
    expect(collect).toHaveLength(1);
    expect(collect[0]).toMatchObject({ model: "SavedView", recordId: collected.id, before: null });
    const before = await prisma.mutationBatch.count({ where: { userId: USER } });
    const silent = await createView(USER, { name: "Quieta", dataset: "ledger", isFavorite: true, config: config() }, prisma, { record: false });
    expect(silent.batchId).toBeNull();
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(before);
  });
});

describe("updateView", () => {
  const make = (name = "Minha") => createView(USER, { name, dataset: "ledger", isFavorite: false, config: config() }, prisma);

  it("404s on a view that is not the user's", async () => {
    const v = await make();
    await expect(updateView(OTHER, v.id, { name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "view.not_found" });
    await expect(updateView(USER, "nope", { name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "view.not_found" });
  });

  it("keeps the built-in view's name, allows the same name, and never keeps its filters", async () => {
    await ensureBuiltinViews(USER, prisma);
    const all = await prisma.savedView.findFirstOrThrow({ where: { userId: USER, isBuiltin: true } });
    await expect(updateView(USER, all.id, { name: "Outra" }, prisma)).rejects.toMatchObject({ status: 422, code: "view.builtin_rename" });
    const same = await updateView(USER, all.id, { name: all.name, isFavorite: false }, prisma);
    expect(same.isFavorite).toBe(false);
    const saved = await updateView(USER, all.id, { config: { layout: "board", search: "x", filters: [{ field: "kind", op: "in", values: ["expense"] }] } }, prisma);
    expect(ledgerConfig(saved)).toMatchObject({ layout: "board", filters: [] });
    expect(ledgerConfig(saved).search).toBeUndefined();
  });

  it("updates position and favorite flag, recording only the favorite toggle", async () => {
    const v = await make();
    const moved = await updateView(USER, v.id, { position: 7 }, prisma);
    expect(moved).toMatchObject({ position: 7, batchId: null });
    const fav = await updateView(USER, v.id, { isFavorite: true }, prisma);
    expect(fav.batchId).not.toBeNull();
    expect((await lastBatch()).op).toBe("view.update");
  });

  it("extends one rename batch while the user types, and starts another after anything else", async () => {
    const v = await make("A");
    const first = await updateView(USER, v.id, { name: "Ab" }, prisma);
    const second = await updateView(USER, v.id, { name: "Abc" }, prisma);
    expect(second.batchId).toBe(first.batchId);
    const batch = await lastBatch();
    expect(batch).toMatchObject({ op: "view.rename", summary: "Abc" });
    expect(batch.records).toHaveLength(1);
    expect(batch.records[0].after).toMatchObject({ name: "Abc" });
    expect(batch.records[0].before).toMatchObject({ name: "A" });

    // A rename together with a favorite toggle is a view.update of its own.
    const both = await updateView(USER, v.id, { name: "Abcd", isFavorite: true }, prisma);
    expect(both.batchId).not.toBe(first.batchId);
    expect((await lastBatch()).op).toBe("view.update");
    // Another record in between: no coalescing.
    const other = await make("B");
    expect(other.batchId).not.toBeNull();
    const renamed = await updateView(USER, v.id, { name: "Zed" }, prisma);
    expect(renamed.batchId).not.toBe(both.batchId);
    expect(renamed.batchId).not.toBe(other.batchId);
  });

  it("does not extend a rename that was undone, one of another view, one older than two minutes, or one of another kind", async () => {
    const v = await make("A");
    const w = await make("W");
    const r1 = await updateView(USER, v.id, { name: "A1" }, prisma);
    await undoBatch(USER, r1.batchId!, prisma);
    const r2 = await updateView(USER, v.id, { name: "A2" }, prisma);
    expect(r2.batchId).not.toBe(r1.batchId);

    const otherView = await updateView(USER, w.id, { name: "W1" }, prisma);
    expect(otherView.batchId).not.toBe(r2.batchId);

    await prisma.mutationBatch.update({ where: { id: otherView.batchId! }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } });
    const late = await updateView(USER, w.id, { name: "W2" }, prisma);
    expect(late.batchId).not.toBe(otherView.batchId);

    const deleted = await deleteView(USER, v.id, prisma);
    expect(deleted.batchId).not.toBeNull();
    const afterDelete = await updateView(USER, w.id, { name: "W3" }, prisma);
    expect(afterDelete.batchId).not.toBe(late.batchId);
  });
});

describe("duplicateView", () => {
  it("404s on a missing view and refuses a config that does not fit the dataset", async () => {
    await expect(duplicateView(USER, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "view.not_found" });
    const v = await createView(USER, { name: "Base", dataset: "ledger", isFavorite: true, config: config() }, prisma);
    await expect(duplicateView(OTHER, v.id, prisma)).rejects.toMatchObject({ code: "view.not_found" });
    await expect(duplicateView(USER, v.id, prisma, { config: { layout: "nope" } })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("names the copy in the user's language and leaves its creation off the log", async () => {
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    const v = await createView(USER, { name: "Base", dataset: "ledger", isFavorite: true, config: config() }, prisma);
    const copy = await duplicateView(USER, v.id, prisma);
    expect(copy.name).toMatch(/^Base \(.+\)$/);
    expect(copy.name).not.toBe("Base (cópia)");
    expect(copy.batchId).toBeNull();
    expect(copy.isFavorite).toBe(true);
  });
});

describe("deleteView", () => {
  it("404s, refuses the built-in view, and undo brings a deleted one back under its id", async () => {
    await expect(deleteView(USER, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "view.not_found" });
    await ensureBuiltinViews(USER, prisma);
    const all = await prisma.savedView.findFirstOrThrow({ where: { userId: USER, isBuiltin: true } });
    await expect(deleteView(USER, all.id, prisma)).rejects.toMatchObject({ status: 422, code: "view.builtin_delete" });
    const v = await createView(USER, { name: "Temp", dataset: "ledger", isFavorite: true, config: config() }, prisma);
    const gone = await deleteView(USER, v.id, prisma);
    expect(await prisma.savedView.count({ where: { id: v.id } })).toBe(0);
    await undoBatch(USER, gone.batchId!, prisma);
    expect(await prisma.savedView.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ name: "Temp" });
  });

  it("hands the record to the caller's batch", async () => {
    const v = await createView(USER, { name: "Temp", dataset: "ledger", isFavorite: true, config: config() }, prisma);
    const collect: MutationRecordInput[] = [];
    const r = await deleteView(USER, v.id, prisma, { collect });
    expect(r.batchId).toBeNull();
    expect(collect).toEqual([expect.objectContaining({ model: "SavedView", recordId: v.id, after: null })]);
  });
});

describe("reorderViews and viewSelection", () => {
  it("refuses an order that names a view the user does not own", async () => {
    const mine = await createView(USER, { name: "Minha", dataset: "ledger", isFavorite: true, config: config() }, prisma);
    const theirs = await createView(OTHER, { name: "Dela", dataset: "ledger", isFavorite: true, config: config() }, prisma);
    await expect(reorderViews(USER, [mine.id, theirs.id], prisma)).rejects.toMatchObject({ status: 404, code: "view.not_found" });
  });

  it("selects the rows of a ledger view with its period, filters and search", async () => {
    const v = await createView(
      USER,
      { name: "Setembro", dataset: "ledger", isFavorite: true, config: config({ period: { from: "2026-09-01", to: "2026-09-30" }, dateField: "effectiveDate", filters: [{ field: "kind", op: "in", values: ["expense"] }], search: "uber" }) },
      prisma
    );
    expect(await viewSelection(USER, v.id, prisma)).toEqual({
      period: { from: "2026-09-01", to: "2026-09-30" },
      dateField: "effectiveDate",
      filters: [{ field: "kind", op: "in", values: ["expense"] }],
      search: "uber",
      deleted: "exclude",
    });
    await expect(viewSelection(OTHER, v.id, prisma)).rejects.toMatchObject({ status: 404, code: "view.not_found" });
  });
});

describe("default views edge cases", () => {
  it("leaves the PJ view where it is when there is no built-in view to follow", async () => {
    await prisma.user.create({ data: { id: BARE, email: `${BARE}@example.com`, passwordHash: "x", name: BARE } });
    await prisma.entity.create({ data: { userId: BARE, kind: "personal", name: "PF" } });
    await ensureDefaultViews(BARE, prisma); // base seeds, no business yet, no "Todas" row
    expect(await prisma.savedView.count({ where: { userId: BARE, isBuiltin: true } })).toBe(0);
    await prisma.entity.create({ data: { userId: BARE, kind: "business", name: "Loja" } });
    expect(await ensureDefaultViews(BARE, prisma)).toContain("pj");
    const pj = await prisma.savedView.findFirstOrThrow({ where: { userId: BARE, seedKey: "pj" } });
    const others = await prisma.savedView.findMany({ where: { userId: BARE, seedKey: { not: "pj" } }, select: { position: true } });
    expect(pj.position).toBeGreaterThan(Math.max(...others.map((o) => o.position)));
  });

  it("ignores seeded views whose config is unreadable or has no filters when migrating the business filter", async () => {
    await prisma.category.create({ data: { userId: USER, name: "Impostos", type: "expense", systemKey: "taxes" } });
    await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Loja" } });
    await ensureDefaultViews(USER, prisma);
    const pj = await prisma.savedView.findFirstOrThrow({ where: { userId: USER, seedKey: "pj" } });
    const taxpj = await prisma.savedView.findFirstOrThrow({ where: { userId: USER, seedKey: "taxpj" } });
    // A config whose filters are not a list, one that does not parse as a view, and one that is null.
    await prisma.savedView.update({ where: { id: pj.id }, data: { config: { filters: "none" } } });
    await prisma.savedView.update({ where: { id: taxpj.id }, data: { config: { layout: "bogus", filters: [{ field: "entityId" }] } } });
    expect(await migrateBusinessViews(USER, prisma)).toEqual([]);
    await prisma.savedView.update({ where: { id: pj.id }, data: { config: Prisma.JsonNull } });
    expect(await migrateBusinessViews(USER, prisma)).toEqual([]);
  });

  it("leaves a PJ filter alone when some business it lists is not one the user has", async () => {
    await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Loja" } });
    await ensureDefaultViews(USER, prisma);
    const pj = await prisma.savedView.findFirstOrThrow({ where: { userId: USER, seedKey: "pj" } });
    const base = pj.config as { filters: unknown[] };
    const stranger = { ...base, filters: [{ field: "entityId", op: "in", values: ["not-a-business"] }] };
    await prisma.savedView.update({ where: { id: pj.id }, data: { config: stranger } });
    expect(await migrateBusinessViews(USER, prisma)).toEqual([]);
    expect((await prisma.savedView.findUniqueOrThrow({ where: { id: pj.id } })).config).toEqual(stranger);
  });

  it("lists views of a single dataset", async () => {
    const holdings = await listViews(USER, prisma, "holdings");
    expect(holdings.length).toBeGreaterThan(0);
    expect(holdings.every((v) => v.dataset === "holdings")).toBe(true);
  });
});
