import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { undoBatch, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { createBudget, deactivateBudget, deleteBudgetChain, endBudgetFrom, listBudgets, serializeBudget, updateBudget } from "../budget-crud";

const USER = "test-user-budgets-crud-branches-001";
const OTHER = "test-user-budgets-crud-branches-002";
let f: LedgerFixture;
let o: LedgerFixture;
let mercado: string;
let viagens: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Mercado", type: "expense" }, { name: "Viagens", type: "expense" }] });
  o = await createLedgerFixture(prisma, OTHER);
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

const budget = (overrides: Partial<Parameters<typeof createBudget>[1]> = {}) =>
  createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 500, effectiveFrom: "2026-01", ...overrides }, prisma);
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("createBudget", () => {
  it("refuses a negative amount, an entity or category that is not the user's, and an archived category", async () => {
    await expect(budget({ amount: -1 })).rejects.toMatchObject({ status: 422, code: "budget.negative_amount" });
    await expect(budget({ entityId: o.pfId })).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
    await expect(budget({ categoryId: o.categories.Groceries })).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await expect(budget({ categoryId: "nope" })).rejects.toMatchObject({ code: "category.not_found" });
    await prisma.category.update({ where: { id: viagens }, data: { isArchived: true } });
    await expect(budget({ categoryId: viagens })).rejects.toMatchObject({ status: 422, code: "category.archived", params: { name: "Viagens" } });
    expect(await prisma.budget.count({ where: { userId: USER } })).toBe(0);
  });

  it("accepts a zero amount and a day-precise start, normalized to the first of the month at noon", async () => {
    const b = await budget({ amount: 0, effectiveFrom: "2026-03-17" });
    expect(Number(b.amount)).toBe(0);
    expect(b.effectiveFrom.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect(b).toMatchObject({ year: 2026, month: 3, period: "monthly", currency: "BRL", rollover: false, kind: null, notes: null });
  });

  it("takes the currency, rollover, notes and kind from the input, and a yearly budget has no month", async () => {
    const b = await budget({ categoryId: viagens, entityId: null, amount: 9000, currency: "USD", period: "yearly", rollover: true, notes: "ferias", kind: "fixo", effectiveFrom: "2026-05" });
    expect(b).toMatchObject({ entityId: null, currency: "USD", period: "yearly", rollover: true, notes: "ferias", kind: "fixo", month: null, year: 2026 });
  });

  it("names the clashing category and revives an inactive row or a tombstone starting the same month", async () => {
    const first = await budget();
    await expect(budget({ amount: 10 })).rejects.toMatchObject({ status: 409, code: "budget.clash", params: { category: "Mercado" } });

    await deactivateBudget(USER, first.id, prisma);
    const revived = await budget({ amount: 640, currency: "EUR", rollover: true, notes: "de novo", kind: "variavel" });
    expect(revived.id).toBe(first.id);
    expect(revived).toMatchObject({ isActive: true, isTombstone: false, currency: "EUR", rollover: true, notes: "de novo", kind: "variavel" });
    expect(Number(revived.amount)).toBe(640);
    expect(revived.batchId).not.toBeNull();
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: revived.batchId! } })).op).toBe("update");

    // The optional fields stay when the input leaves them out.
    await deactivateBudget(USER, first.id, prisma);
    const again = await budget({ amount: 700 });
    expect(again).toMatchObject({ id: first.id, currency: "EUR", rollover: true, notes: "de novo", kind: "variavel" });

    await prisma.budget.update({ where: { id: first.id }, data: { isTombstone: true } });
    const overTombstone = await budget({ amount: 300 });
    expect(overTombstone).toMatchObject({ id: first.id, isTombstone: false, isActive: true });
  });

  it("hands the record to the caller's batch instead of recording one, for a revived row and a new one", async () => {
    const first = await budget();
    await deactivateBudget(USER, first.id, prisma);
    const collect: MutationRecordInput[] = [];
    const revived = await createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 1, effectiveFrom: "2026-01" }, prisma, { collect });
    expect(revived.id).toBe(first.id);
    expect(revived.batchId).toBeNull();
    expect(collect).toEqual([expect.objectContaining({ model: "Budget", recordId: first.id })]);
    expect(collect[0].before).not.toBeNull();

    const fresh = await createBudget(USER, { entityId: f.pjId, categoryId: mercado, amount: 1, effectiveFrom: "2026-01" }, prisma, { collect });
    expect(fresh.batchId).toBeNull();
    expect(collect).toHaveLength(2);
    expect(collect[1]).toMatchObject({ model: "Budget", recordId: fresh.id, before: null });
  });
});

describe("updateBudget", () => {
  it("404s on a budget that is not the user's and refuses a negative amount", async () => {
    const b = await budget();
    await expect(updateBudget(OTHER, b.id, { amount: 1 }, prisma)).rejects.toMatchObject({ status: 404, code: "budget.not_found" });
    await expect(updateBudget(USER, "nope", { amount: 1 }, prisma)).rejects.toMatchObject({ code: "budget.not_found" });
    await expect(updateBudget(USER, b.id, { amount: -5 }, prisma)).rejects.toMatchObject({ code: "budget.negative_amount" });
  });

  it("changes each field in place, and a deactivation is recorded as a delete", async () => {
    const b = await budget();
    const edited = await updateBudget(USER, b.id, { amount: 800, currency: "USD", rollover: true, notes: "nova nota", kind: "fixo" }, prisma);
    expect(edited).toMatchObject({ currency: "USD", rollover: true, notes: "nova nota", kind: "fixo" });
    expect(Number(edited.amount)).toBe(800);
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: edited.batchId! } })).op).toBe("update");
    const cleared = await updateBudget(USER, b.id, { notes: null, kind: null }, prisma);
    expect(cleared).toMatchObject({ notes: null, kind: null });
    const off = await updateBudget(USER, b.id, { isActive: false }, prisma);
    expect(off.isActive).toBe(false);
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: off.batchId! } })).op).toBe("delete");
    const on = await updateBudget(USER, b.id, { isActive: true }, prisma);
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: on.batchId! } })).op).toBe("update");
  });

  it("moves the start month, which changes the year and month, and refuses a month another version holds", async () => {
    const b = await budget();
    await budget({ effectiveFrom: "2026-06" });
    const moved = await updateBudget(USER, b.id, { effectiveFrom: "2025-12-20" }, prisma);
    expect(day(moved.effectiveFrom)).toBe("2025-12-01");
    expect(moved).toMatchObject({ year: 2025, month: 12 });
    await expect(updateBudget(USER, b.id, { effectiveFrom: "2026-06" }, prisma)).rejects.toMatchObject({ status: 409, code: "budget.clash", params: { category: "Mercado" } });
  });

  it("switching the period changes the unique key: a clash is refused, otherwise month and year follow", async () => {
    const monthly = await budget();
    await budget({ period: "yearly" });
    await expect(updateBudget(USER, monthly.id, { period: "yearly" }, prisma)).rejects.toMatchObject({ code: "budget.clash" });
    const other = await budget({ categoryId: viagens, effectiveFrom: "2026-04" });
    const switched = await updateBudget(USER, other.id, { period: "yearly" }, prisma);
    expect(switched).toMatchObject({ period: "yearly", month: null, year: 2026 });
    const back = await updateBudget(USER, other.id, { period: "monthly" }, prisma);
    expect(back).toMatchObject({ period: "monthly", month: 4 });
  });

  it("applyFrom: a later month makes a new version carrying the patched fields, with notes and kind it did not change", async () => {
    const jan = await budget({ notes: "base", kind: "fixo", rollover: true, currency: "BRL" });
    const sep = await updateBudget(USER, jan.id, { amount: 700, applyFrom: "2026-09" }, prisma);
    expect(sep.id).not.toBe(jan.id);
    expect(sep).toMatchObject({ notes: "base", kind: "fixo", rollover: true, currency: "BRL", month: 9, year: 2026 });
    const dec = await updateBudget(USER, jan.id, { amount: 900, notes: null, kind: null, rollover: false, currency: "USD", applyFrom: "2026-12" }, prisma);
    expect(dec).toMatchObject({ notes: null, kind: null, rollover: false, currency: "USD", month: 12 });
    // A version already there for that month is changed, not duplicated.
    const sepAgain = await updateBudget(USER, jan.id, { amount: 710, applyFrom: "2026-09" }, prisma);
    expect(sepAgain.id).toBe(sep.id);
    expect(await prisma.budget.count({ where: { userId: USER, categoryId: mercado } })).toBe(3);
  });

  it("applyFrom revives an inactive version of that month", async () => {
    const jan = await budget();
    const sep = await updateBudget(USER, jan.id, { amount: 700, applyFrom: "2026-09" }, prisma);
    await deactivateBudget(USER, sep.id, prisma);
    const revived = await updateBudget(USER, jan.id, { amount: 720, applyFrom: "2026-09" }, prisma);
    expect(revived).toMatchObject({ id: sep.id, isActive: true, isTombstone: false });
    expect(Number(revived.amount)).toBe(720);
  });

  it("applyFrom in the same month, or the same year of a yearly budget, changes the version in place", async () => {
    const jan = await budget();
    const inPlace = await updateBudget(USER, jan.id, { amount: 510, applyFrom: "2026-01" }, prisma);
    expect(inPlace.id).toBe(jan.id);
    const yearly = await budget({ categoryId: viagens, entityId: null, period: "yearly", effectiveFrom: "2026-01", amount: 9000 });
    const sameYear = await updateBudget(USER, yearly.id, { amount: 9500, applyFrom: "2026-08" }, prisma);
    expect(sameYear.id).toBe(yearly.id);
    expect(Number(sameYear.amount)).toBe(9500);
    const nextYear = await updateBudget(USER, yearly.id, { amount: 12000, applyFrom: "2027-03" }, prisma);
    expect(nextYear.id).not.toBe(yearly.id);
    expect(nextYear).toMatchObject({ year: 2027, month: null });
    expect(day(nextYear.effectiveFrom)).toBe("2027-01-01");
    await expect(updateBudget(USER, nextYear.id, { amount: 1, applyFrom: "2026-05" }, prisma)).rejects.toMatchObject({ code: "budget.apply_before_start" });
  });

  it("mode in_place ignores applyFrom, and mode version without one changes the row", async () => {
    const jan = await budget();
    const inPlace = await updateBudget(USER, jan.id, { amount: 123, applyFrom: "2026-09" }, prisma, { mode: "in_place" });
    expect(inPlace.id).toBe(jan.id);
    expect(await prisma.budget.count({ where: { userId: USER } })).toBe(1);
    const noApply = await updateBudget(USER, jan.id, { amount: 124 }, prisma, { mode: "version" });
    expect(noApply.id).toBe(jan.id);
  });

  it("collects the record into the caller's batch", async () => {
    const jan = await budget();
    const collect: MutationRecordInput[] = [];
    const edited = await updateBudget(USER, jan.id, { amount: 5 }, prisma, { collect });
    expect(edited.batchId).toBeNull();
    expect(collect).toHaveLength(1);
    const versioned = await updateBudget(USER, jan.id, { amount: 6, applyFrom: "2026-07" }, prisma, { collect });
    expect(versioned.batchId).toBeNull();
    expect(collect).toHaveLength(2);
    expect(collect[1].before).toBeNull();
  });
});

describe("endBudgetFrom and deleteBudgetChain", () => {
  it("404s for a budget that is not the user's", async () => {
    const b = await budget();
    await expect(endBudgetFrom(OTHER, b.id, "2026-05", prisma)).rejects.toMatchObject({ status: 404, code: "budget.not_found" });
    await expect(deleteBudgetChain(OTHER, b.id, prisma)).rejects.toMatchObject({ code: "budget.not_found" });
  });

  it("puts the tombstone of a yearly budget on its January, with no month", async () => {
    const v2026 = await budget({ categoryId: viagens, entityId: null, period: "yearly", amount: 9000 });
    await updateBudget(USER, v2026.id, { amount: 12000, applyFrom: "2027-01" }, prisma);
    const ended = await endBudgetFrom(USER, v2026.id, "2028-06", prisma);
    expect(ended.batchId).not.toBeNull();
    const tombstone = await prisma.budget.findFirstOrThrow({ where: { userId: USER, categoryId: viagens, isTombstone: true } });
    expect(day(tombstone.effectiveFrom)).toBe("2028-01-01");
    expect(tombstone).toMatchObject({ period: "yearly", month: null, year: 2028, isActive: true });
  });

  it("reuses a version already starting at the month as the tombstone, or stops it when nothing older would surface", async () => {
    const jan = await budget();
    const sep = await updateBudget(USER, jan.id, { amount: 700, applyFrom: "2026-09" }, prisma);
    // An older version would come back: the September version becomes the tombstone itself.
    await endBudgetFrom(USER, jan.id, "2026-09", prisma);
    expect(await prisma.budget.findUniqueOrThrow({ where: { id: sep.id } })).toMatchObject({ isTombstone: true, isActive: true });
    // Ending again from the same month changes nothing and records nothing.
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    const same = await endBudgetFrom(USER, jan.id, "2026-09", prisma);
    expect(same.batchId).toBeNull();
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
    // A tombstone before it ends the chain: nothing resurfaces, and an active version at the month is stopped.
    const lone = await budget({ categoryId: viagens, amount: 100, effectiveFrom: "2026-05" });
    const stopped = await endBudgetFrom(USER, lone.id, "2026-05", prisma);
    expect(stopped.isActive).toBe(false);
  });

  it("revives an inactive version at the month as a tombstone, and collects the records", async () => {
    const jan = await budget();
    const sep = await updateBudget(USER, jan.id, { amount: 700, applyFrom: "2026-09" }, prisma);
    await deactivateBudget(USER, sep.id, prisma);
    const collect: MutationRecordInput[] = [];
    const ended = await endBudgetFrom(USER, jan.id, "2026-09", prisma, { collect });
    expect(ended.batchId).toBeNull();
    expect(await prisma.budget.findUniqueOrThrow({ where: { id: sep.id } })).toMatchObject({ isActive: true, isTombstone: true });
    expect(collect).toHaveLength(1);
  });

  it("stops every active version and records nothing when none is left", async () => {
    const jan = await budget();
    await updateBudget(USER, jan.id, { amount: 700, applyFrom: "2026-09" }, prisma);
    const r = await deleteBudgetChain(USER, jan.id, prisma);
    expect(r.batchId).not.toBeNull();
    expect(await prisma.budget.count({ where: { userId: USER, isActive: true } })).toBe(0);
    const again = await deleteBudgetChain(USER, jan.id, prisma);
    expect(again.batchId).toBeNull();
    await undoBatch(USER, r.batchId!, prisma);
    expect(await prisma.budget.count({ where: { userId: USER, isActive: true } })).toBe(2);
    const collect: MutationRecordInput[] = [];
    const collected = await deleteBudgetChain(USER, jan.id, prisma, { collect });
    expect(collected.batchId).toBeNull();
    expect(collect).toHaveLength(2);
  });
});

describe("listBudgets and serializeBudget", () => {
  it("lists the active versions, filtered by entity (including every entity) and category", async () => {
    const pf = await budget();
    const all = await budget({ entityId: null, categoryId: viagens });
    const tombstoned = await budget({ entityId: f.pjId, categoryId: viagens });
    await prisma.budget.update({ where: { id: tombstoned.id }, data: { isTombstone: true } });
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    expect(ids(await listBudgets(USER, prisma))).toEqual(ids([pf, all]));
    expect(ids(await listBudgets(USER, prisma, { entityId: f.pfId }))).toEqual([pf.id]);
    expect(ids(await listBudgets(USER, prisma, { entityId: null }))).toEqual([all.id]);
    expect(ids(await listBudgets(USER, prisma, { categoryId: viagens }))).toEqual([all.id]);
    expect(await listBudgets(OTHER, prisma)).toEqual([]);
  });

  it("lists what was in force at a date, narrowed by entity and category", async () => {
    const jan = await budget();
    const sep = await updateBudget(USER, jan.id, { amount: 700, applyFrom: "2026-09" }, prisma);
    await budget({ categoryId: viagens, effectiveFrom: "2026-06" });
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-08" })).map((b) => b.id).sort()).toEqual([jan.id, (await prisma.budget.findFirstOrThrow({ where: { categoryId: viagens } })).id].sort());
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-10-15", categoryId: mercado })).map((b) => b.id)).toEqual([sep.id]);
    expect(await listBudgets(USER, prisma, { effectiveAt: "2026-10", entityId: f.pjId })).toEqual([]);
    expect(await listBudgets(USER, prisma, { effectiveAt: "2025-12" })).toEqual([]);
  });

  it("serializes the amount as a number, the start as a date and the category by name", async () => {
    const b = await budget({ amount: 1234.56, kind: "fixo", notes: "n" });
    const row = await prisma.budget.findUniqueOrThrow({ where: { id: b.id }, include: { category: true } });
    expect(serializeBudget(row)).toEqual({
      id: b.id,
      entityId: f.pfId,
      categoryId: mercado,
      category: "Mercado",
      amount: 1234.56,
      currency: "BRL",
      period: "monthly",
      effectiveFrom: "2026-01-01",
      rollover: false,
      isActive: true,
      isTombstone: false,
      notes: "n",
      kind: "fixo",
    });
  });
});
