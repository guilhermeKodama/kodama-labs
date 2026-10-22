import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { getEffectiveBudgetsByMonth, getEffectiveBudgetsForMonth } from "../../lib/effective-budgets";
import { createBudget, deactivateBudget, endBudgetFrom, listBudgets, serializeBudget, updateBudget } from "../budget-crud";

const USER = "test-user-budget-crud-001";
const OTHER = "test-user-budget-crud-002";
let f: LedgerFixture;
let other: LedgerFixture;
let mercado: string;
let viagens: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Mercado", type: "expense" }, { name: "Viagens", type: "expense" }] });
  other = await createLedgerFixture(prisma, OTHER, { baseCurrency: "USD", categories: [{ name: "Mercado", type: "expense" }] });
  mercado = f.categories.Mercado;
  viagens = f.categories.Viagens;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const make = (amount: number, effectiveFrom = "2026-01", extra: Partial<Parameters<typeof createBudget>[1]> = {}) =>
  createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount, effectiveFrom, ...extra }, prisma);

describe("createBudget", () => {
  it("creates a monthly budget at noon UTC with the user's base currency, and undoes", async () => {
    const b = await make(500, "2026-03-17");
    expect(b).toMatchObject({ userId: USER, entityId: f.pfId, categoryId: mercado, period: "monthly", year: 2026, month: 3, currency: "BRL", rollover: false, notes: null, isActive: true, isTombstone: false });
    expect(Number(b.amount)).toBe(500);
    expect(b.effectiveFrom.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect(b.batchId).toBeTruthy();

    await undoBatch(USER, b.batchId!, prisma);
    expect(await prisma.budget.count({ where: { id: b.id } })).toBe(0);
  });

  it("uses the base currency of the user it belongs to, unless one is given", async () => {
    const usd = await createBudget(OTHER, { categoryId: other.categories.Mercado, amount: 10, effectiveFrom: "2026-01" }, prisma);
    expect(usd.currency).toBe("USD");
    const eur = await make(10, "2026-01", { currency: "EUR" });
    expect(eur.currency).toBe("EUR");
  });

  it("stores a yearly budget with month null, a null entity for every entity, and notes", async () => {
    const b = await createBudget(USER, { categoryId: viagens, amount: 25000, period: "yearly", effectiveFrom: "2026-05", rollover: true, notes: "férias" }, prisma);
    expect(b).toMatchObject({ period: "yearly", year: 2026, month: null, entityId: null, rollover: true, notes: "férias" });
  });

  it("rejects a negative amount", async () => {
    await expect(make(-1)).rejects.toMatchObject({ status: 422, code: "budget.negative_amount" });
    expect(await prisma.budget.count({ where: { userId: USER } })).toBe(0);
    expect(Number((await make(0)).amount)).toBe(0);
  });

  it("rejects an archived category", async () => {
    await prisma.category.update({ where: { id: viagens }, data: { isArchived: true } });
    await expect(make(1, "2026-01", { categoryId: viagens })).rejects.toMatchObject({ status: 422, code: "category.archived" });
  });

  it("rejects an entity or a category that does not exist or belongs to someone else", async () => {
    await expect(make(1, "2026-01", { entityId: "nope" })).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
    await expect(make(1, "2026-01", { entityId: other.pfId })).rejects.toMatchObject({ code: "entity.not_found" });
    await expect(make(1, "2026-01", { categoryId: "nope" })).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await expect(make(1, "2026-01", { categoryId: other.categories.Mercado })).rejects.toMatchObject({ code: "category.not_found" });
  });

  it("answers 409 when an active budget already starts in that month, but lets another period or entity through", async () => {
    await make(500, "2026-03");
    await expect(make(600, "2026-03-20")).rejects.toMatchObject({ status: 409, code: "budget.clash", params: { category: "Mercado" } });
    await expect(make(1, "2026-03", { period: "yearly" })).resolves.toMatchObject({ period: "yearly" });
    await expect(make(1, "2026-03", { entityId: f.pjId })).resolves.toMatchObject({ entityId: f.pjId });
    await expect(make(1, "2026-03", { entityId: null })).resolves.toMatchObject({ entityId: null });
  });

  it("revives an inactive row starting in the same month, and undoes back to inactive", async () => {
    const old = await make(500, "2026-03", { notes: "velho" });
    await deactivateBudget(USER, old.id, prisma);
    const revived = await make(700, "2026-03", { currency: "USD", rollover: true });
    expect(revived.id).toBe(old.id);
    expect(revived).toMatchObject({ isActive: true, isTombstone: false, currency: "USD", rollover: true, notes: "velho" });
    expect(Number(revived.amount)).toBe(700);

    await undoBatch(USER, revived.batchId!, prisma);
    const row = await prisma.budget.findUniqueOrThrow({ where: { id: old.id } });
    expect(row).toMatchObject({ isActive: false });
    expect(Number(row.amount)).toBe(500);
  });

  it("revives a tombstone as a real budget", async () => {
    const jan = await make(500, "2026-01");
    await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    await endBudgetFrom(USER, jan.id, "2026-09", prisma);
    const tombstone = await prisma.budget.findFirstOrThrow({ where: { userId: USER, isTombstone: true } });
    const revived = await make(900, "2026-09");
    expect(revived).toMatchObject({ id: tombstone.id, isTombstone: false, isActive: true });
    expect(Number(revived.amount)).toBe(900);
    expect((await getEffectiveBudgetsForMonth(prisma, USER, new Date("2026-10-15T12:00:00Z"))).map((b) => b.id)).toEqual([tombstone.id]);
  });

  it("collects the mutation records instead of opening a batch", async () => {
    const collect: NonNullable<Parameters<typeof createBudget>[3]>["collect"] = [];
    const b = await createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 1, effectiveFrom: "2026-01" }, prisma, { collect });
    expect(b.batchId).toBeNull();
    expect(collect).toHaveLength(1);
    expect(collect![0]).toMatchObject({ model: "Budget", recordId: b.id, before: null });
  });
});

describe("updateBudget", () => {
  it("changes a version in place and undoes", async () => {
    const b = await make(500);
    const u = await updateBudget(USER, b.id, { amount: 650, currency: "USD", rollover: true, notes: "n" }, prisma);
    expect(u).toMatchObject({ id: b.id, currency: "USD", rollover: true, notes: "n" });
    expect(Number(u.amount)).toBe(650);
    await undoBatch(USER, u.batchId!, prisma);
    const row = await prisma.budget.findUniqueOrThrow({ where: { id: b.id } });
    expect(Number(row.amount)).toBe(500);
    expect(row).toMatchObject({ currency: "BRL", rollover: false, notes: null });
  });

  it("rejects a negative amount and leaves the row alone", async () => {
    const b = await make(500);
    await expect(updateBudget(USER, b.id, { amount: -5 }, prisma)).rejects.toMatchObject({ status: 422, code: "budget.negative_amount" });
    expect(Number((await prisma.budget.findUniqueOrThrow({ where: { id: b.id } })).amount)).toBe(500);
  });

  it("does not find a budget of another user or one that does not exist", async () => {
    const b = await make(500);
    await expect(updateBudget(OTHER, b.id, { amount: 1 }, prisma)).rejects.toMatchObject({ status: 404, code: "budget.not_found" });
    await expect(updateBudget(USER, "nope", { amount: 1 }, prisma)).rejects.toMatchObject({ code: "budget.not_found" });
    expect(Number((await prisma.budget.findUniqueOrThrow({ where: { id: b.id } })).amount)).toBe(500);
  });

  it("moves the start month, keeping year and month in step", async () => {
    const b = await make(500, "2026-01");
    const moved = await updateBudget(USER, b.id, { effectiveFrom: "2026-04" }, prisma);
    expect(moved).toMatchObject({ year: 2026, month: 4 });
    expect(moved.effectiveFrom.toISOString()).toBe("2026-04-01T12:00:00.000Z");
  });

  it("answers 409 when the new start month or period collides with another version", async () => {
    const jan = await make(500, "2026-01");
    const mar = await make(600, "2026-03");
    await expect(updateBudget(USER, jan.id, { effectiveFrom: "2026-03" }, prisma)).rejects.toMatchObject({ status: 409, code: "budget.clash", params: { category: "Mercado" } });
    await make(1, "2026-01", { period: "yearly" });
    await expect(updateBudget(USER, jan.id, { period: "yearly" }, prisma)).rejects.toMatchObject({ status: 409, code: "budget.clash" });
    // Moving onto its own month is not a clash.
    await expect(updateBudget(USER, mar.id, { effectiveFrom: "2026-03-20", amount: 650 }, prisma)).resolves.toMatchObject({ id: mar.id });
  });

  it("switches a monthly budget to yearly, clearing the month", async () => {
    const b = await make(500, "2026-03");
    expect(await updateBudget(USER, b.id, { period: "yearly" }, prisma)).toMatchObject({ period: "yearly", month: null, year: 2026 });
  });
});

describe("deactivateBudget", () => {
  it("soft deletes one version and undo brings it back", async () => {
    const jan = await make(500, "2026-01");
    const jun = await make(800, "2026-06");
    const gone = await deactivateBudget(USER, jun.id, prisma);
    expect(gone).toMatchObject({ id: jun.id, isActive: false });
    expect(await prisma.budget.count({ where: { id: jun.id } })).toBe(1);
    // The older version is in force again: the soft delete has no tombstone.
    expect((await getEffectiveBudgetsForMonth(prisma, USER, new Date("2026-08-01T12:00:00Z"))).map((b) => b.id)).toEqual([jan.id]);

    await undoBatch(USER, gone.batchId!, prisma);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: jun.id } })).isActive).toBe(true);
    expect((await getEffectiveBudgetsForMonth(prisma, USER, new Date("2026-08-01T12:00:00Z"))).map((b) => b.id)).toEqual([jun.id]);
  });

  it("does not touch another user's budget", async () => {
    const b = await make(500);
    await expect(deactivateBudget(OTHER, b.id, prisma)).rejects.toMatchObject({ code: "budget.not_found" });
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: b.id } })).isActive).toBe(true);
  });
});

describe("listBudgets", () => {
  it("lists active versions with their category, leaving out inactive rows, tombstones and other users", async () => {
    const jan = await make(500, "2026-01");
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    const trip = await createBudget(USER, { categoryId: viagens, amount: 9000, period: "yearly", effectiveFrom: "2026-01" }, prisma);
    const dead = await make(1, "2026-02", { entityId: f.pjId });
    await deactivateBudget(USER, dead.id, prisma);
    await endBudgetFrom(USER, jun.id, "2026-09", prisma);
    await createBudget(OTHER, { categoryId: other.categories.Mercado, amount: 1, effectiveFrom: "2026-01" }, prisma);

    const all = await listBudgets(USER, prisma);
    expect(all.map((b) => b.id).sort()).toEqual([jan.id, jun.id, trip.id].sort());
    expect(all.every((b) => b.category.name.length > 0 && !b.isTombstone)).toBe(true);
    // Per category, newest version first.
    const mercados = all.filter((b) => b.categoryId === mercado).map((b) => b.id);
    expect(mercados).toEqual([jun.id, jan.id]);
  });

  it("filters by entity (null = every entity) and category", async () => {
    const pf = await make(1, "2026-01");
    const pj = await make(2, "2026-01", { entityId: f.pjId });
    const all = await make(3, "2026-01", { entityId: null });
    const trip = await createBudget(USER, { entityId: f.pfId, categoryId: viagens, amount: 4, effectiveFrom: "2026-01" }, prisma);
    const ids = async (filters: Parameters<typeof listBudgets>[2]) => (await listBudgets(USER, prisma, filters)).map((b) => b.id).sort();
    expect(await ids({ entityId: f.pfId })).toEqual([pf.id, trip.id].sort());
    expect(await ids({ entityId: f.pjId })).toEqual([pj.id]);
    expect(await ids({ entityId: null })).toEqual([all.id]);
    expect(await ids({ categoryId: viagens })).toEqual([trip.id]);
    expect(await ids({ entityId: f.pfId, categoryId: mercado })).toEqual([pf.id]);
  });

  it("lists the versions in force at a month with effectiveAt, honoring the filters", async () => {
    const jan = await make(500, "2026-01");
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    const trip = await createBudget(USER, { entityId: f.pfId, categoryId: viagens, amount: 4, effectiveFrom: "2026-01" }, prisma);
    const at = async (effectiveAt: string, filters: { categoryId?: string; entityId?: string | null } = {}) =>
      (await listBudgets(USER, prisma, { effectiveAt, ...filters })).map((b) => b.id).sort();
    expect(await at("2025-12")).toEqual([]);
    expect(await at("2026-05")).toEqual([jan.id, trip.id].sort());
    expect(await at("2026-06-15")).toEqual([jun.id, trip.id].sort());
    expect(await at("2026-06", { categoryId: viagens })).toEqual([trip.id]);
    expect(await at("2026-06", { entityId: f.pjId })).toEqual([]);
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-06" }))[0].category).toBeDefined();
  });
});

describe("serializeBudget", () => {
  it("flattens a budget to plain values", async () => {
    const b = await make(1234.5, "2026-03-20", { notes: "oi", rollover: true });
    const [row] = await listBudgets(USER, prisma, { categoryId: mercado });
    expect(serializeBudget(row)).toEqual({
      id: b.id,
      entityId: f.pfId,
      categoryId: mercado,
      category: "Mercado",
      amount: 1234.5,
      currency: "BRL",
      period: "monthly",
      effectiveFrom: "2026-03-01",
      rollover: true,
      isActive: true,
      isTombstone: false,
      notes: "oi",
    });
  });
});

describe("getEffectiveBudgetsForMonth / getEffectiveBudgetsByMonth", () => {
  it("resolves a month from the most recent version, normalizing the date and honoring filters", async () => {
    const jan = await make(500, "2026-01");
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    const pj = await make(7, "2026-01", { entityId: f.pjId });
    const ids = async (d: string, filters: Parameters<typeof getEffectiveBudgetsForMonth>[3] = {}) =>
      (await getEffectiveBudgetsForMonth(prisma, USER, new Date(d), filters)).map((b) => b.id).sort();
    expect(await ids("2026-05-31T23:00:00Z")).toEqual([jan.id, pj.id].sort());
    expect(await ids("2026-06-01T00:00:00Z")).toEqual([jun.id, pj.id].sort());
    expect(await ids("2026-06-30T23:59:59Z", { entityId: f.pjId })).toEqual([pj.id]);
    expect(await ids("2026-06-10T12:00:00Z", { categoryId: viagens })).toEqual([]);
    expect(await ids("2025-12-10T12:00:00Z")).toEqual([]);
    expect(await getEffectiveBudgetsForMonth(prisma, OTHER, new Date("2026-06-10T12:00:00Z"))).toEqual([]);
  });

  it("resolves a legacy midnight-UTC row for its own month", async () => {
    const b = await make(500, "2026-03");
    await prisma.budget.update({ where: { id: b.id }, data: { effectiveFrom: new Date("2026-03-01T00:00:00Z") } });
    expect((await getEffectiveBudgetsForMonth(prisma, USER, new Date("2026-03-15T12:00:00Z"))).map((x) => x.id)).toEqual([b.id]);
    expect(await getEffectiveBudgetsForMonth(prisma, USER, new Date("2026-02-15T12:00:00Z"))).toEqual([]);
  });

  it("gives the twelve months of a year from one query, ending at a tombstone", async () => {
    const jan = await make(500, "2026-01");
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    await endBudgetFrom(USER, jun.id, "2026-09", prisma);
    const year = await getEffectiveBudgetsByMonth(prisma, USER, 2026);
    expect(year).toHaveLength(12);
    const idsByMonth = year.map((m) => m.map((b) => b.id));
    expect(idsByMonth).toEqual([...Array(5).fill([jan.id]), ...Array(3).fill([jun.id]), ...Array(4).fill([])]);
    expect((await getEffectiveBudgetsByMonth(prisma, USER, 2025)).flat()).toEqual([]);
    expect((await getEffectiveBudgetsByMonth(prisma, OTHER, 2026)).flat()).toEqual([]);
  });
});
