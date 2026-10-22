import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { createBudget, deactivateBudget, deleteBudgetChain, endBudgetFrom, listBudgets, serializeBudget, updateBudget } from "../budget-crud";

const USER = "test-user-budget-crud-001";
const OTHER = "test-user-budget-crud-002";
let f: LedgerFixture;
let other: LedgerFixture;
let mercado: string;
let viagens: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    baseCurrency: "USD",
    categories: [
      { name: "Mercado", type: "expense" },
      { name: "Viagens", type: "expense" },
    ],
  });
  other = await createLedgerFixture(prisma, OTHER, { categories: [{ name: "Outros", type: "expense" }] });
  mercado = f.categories.Mercado;
  viagens = f.categories.Viagens;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const pfMercado = (amount: number, effectiveFrom = "2026-01") => createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount, effectiveFrom }, prisma);

describe("createBudget validation", () => {
  it("rejects a negative amount", async () => {
    await expect(pfMercado(-1)).rejects.toMatchObject({ status: 422, code: "budget.negative_amount" });
    expect(await prisma.budget.count({ where: { userId: USER } })).toBe(0);
  });

  it("accepts a zero amount", async () => {
    expect(await pfMercado(0)).toMatchObject({ isActive: true });
  });

  it("rejects an unknown entity or category", async () => {
    await expect(createBudget(USER, { entityId: "nope", categoryId: mercado, amount: 1, effectiveFrom: "2026-01" }, prisma)).rejects.toMatchObject({
      status: 404,
      code: "entity.not_found",
    });
    await expect(createBudget(USER, { entityId: f.pfId, categoryId: "nope", amount: 1, effectiveFrom: "2026-01" }, prisma)).rejects.toMatchObject({
      status: 404,
      code: "category.not_found",
    });
  });

  it("rejects another user's entity or category", async () => {
    await expect(createBudget(USER, { entityId: other.pfId, categoryId: mercado, amount: 1, effectiveFrom: "2026-01" }, prisma)).rejects.toMatchObject({
      code: "entity.not_found",
    });
    await expect(createBudget(USER, { entityId: f.pfId, categoryId: other.categories.Outros, amount: 1, effectiveFrom: "2026-01" }, prisma)).rejects.toMatchObject({
      code: "category.not_found",
    });
  });

  it("rejects an archived category", async () => {
    await prisma.category.update({ where: { id: viagens }, data: { isArchived: true } });
    await expect(createBudget(USER, { entityId: f.pfId, categoryId: viagens, amount: 1, effectiveFrom: "2026-01" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "category.archived",
      params: { name: "Viagens" },
    });
  });

  it("clashes when an active budget already starts in that month", async () => {
    await pfMercado(500);
    await expect(pfMercado(600, "2026-01-15")).rejects.toMatchObject({ status: 409, code: "budget.clash", params: { category: "Mercado" } });
    // Another period or another entity is another chain.
    await createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 6000, period: "yearly", effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { entityId: null, categoryId: mercado, amount: 700, effectiveFrom: "2026-01" }, prisma);
  });

  it("uses the user's base currency unless one is given", async () => {
    expect(await pfMercado(500)).toMatchObject({ currency: "USD" });
    const brl = await createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 500, currency: "BRL", effectiveFrom: "2026-02" }, prisma);
    expect(brl.currency).toBe("BRL");
  });

  it("normalizes the start to the first of the month and fills year/month", async () => {
    const b = await pfMercado(500, "2026-09-22");
    expect(b.effectiveFrom.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(b).toMatchObject({ year: 2026, month: 9, period: "monthly", rollover: false, notes: null });
  });
});

describe("createBudget reviving", () => {
  it("revives an inactive row of the same month, with one undo batch", async () => {
    const first = await pfMercado(500);
    await deactivateBudget(USER, first.id, prisma);
    const again = await createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 800, rollover: true, notes: "de volta", effectiveFrom: "2026-01" }, prisma);
    expect(again).toMatchObject({ id: first.id, isActive: true, isTombstone: false, rollover: true, notes: "de volta" });
    expect(Number(again.amount)).toBe(800);
    expect(again.batchId).toBeTruthy();
    expect(await prisma.budget.count({ where: { userId: USER } })).toBe(1);

    await undoBatch(USER, again.batchId!, prisma);
    expect(await prisma.budget.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ isActive: false });
  });

  it("revives a tombstone of the same month", async () => {
    const jan = await pfMercado(500);
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    await endBudgetFrom(USER, jun.id, "2026-06", prisma);
    expect(await prisma.budget.findUniqueOrThrow({ where: { id: jun.id } })).toMatchObject({ isTombstone: true });
    const back = await pfMercado(650, "2026-06");
    expect(back).toMatchObject({ id: jun.id, isTombstone: false, isActive: true });
    expect(Number(back.amount)).toBe(650);
  });
});

describe("updateBudget", () => {
  it("rejects a negative amount and an unknown budget", async () => {
    const b = await pfMercado(500);
    await expect(updateBudget(USER, b.id, { amount: -5 }, prisma)).rejects.toMatchObject({ status: 422, code: "budget.negative_amount" });
    await expect(updateBudget(USER, "nope", { amount: 5 }, prisma)).rejects.toMatchObject({ status: 404, code: "budget.not_found" });
  });

  it("changes the row in place without applyFrom, and undoes", async () => {
    const b = await pfMercado(500);
    const updated = await updateBudget(USER, b.id, { amount: 750, notes: "ajuste", rollover: true }, prisma);
    expect(updated.id).toBe(b.id);
    expect(Number(updated.amount)).toBe(750);
    expect(updated).toMatchObject({ notes: "ajuste", rollover: true });
    expect(await prisma.budget.count({ where: { userId: USER } })).toBe(1);

    await undoBatch(USER, updated.batchId!, prisma);
    const row = await prisma.budget.findUniqueOrThrow({ where: { id: b.id } });
    expect(Number(row.amount)).toBe(500);
    expect(row.rollover).toBe(false);
  });

  it("does not let applyFrom precede the month the budget starts", async () => {
    const jun = await pfMercado(500, "2026-06");
    await expect(updateBudget(USER, jun.id, { amount: 1, applyFrom: "2026-03" }, prisma)).rejects.toMatchObject({ status: 422, code: "budget.apply_before_start" });
  });

  it("clashes when moving the start onto another version", async () => {
    const jan = await pfMercado(500);
    const mar = await pfMercado(600, "2026-03");
    await expect(updateBudget(USER, mar.id, { effectiveFrom: "2026-01" }, prisma)).rejects.toMatchObject({ status: 409, code: "budget.clash", params: { category: "Mercado" } });
    const moved = await updateBudget(USER, mar.id, { effectiveFrom: "2026-04" }, prisma);
    expect(moved).toMatchObject({ month: 4, year: 2026 });
    expect(moved.effectiveFrom.toISOString()).toBe("2026-04-01T12:00:00.000Z");
    expect(jan.id).not.toBe(mar.id);
  });

  it("clashes when switching the period onto another version", async () => {
    const monthly = await pfMercado(500);
    await createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 6000, period: "yearly", effectiveFrom: "2026-01" }, prisma);
    await expect(updateBudget(USER, monthly.id, { period: "yearly" }, prisma)).rejects.toMatchObject({ status: 409, code: "budget.clash" });
  });

  it("switches the period when nothing is in the way", async () => {
    const monthly = await pfMercado(500, "2026-05");
    const yearly = await updateBudget(USER, monthly.id, { period: "yearly" }, prisma);
    expect(yearly).toMatchObject({ id: monthly.id, period: "yearly", month: null, year: 2026 });
  });

  it("does not touch another user's budget", async () => {
    const b = await pfMercado(500);
    await expect(updateBudget(OTHER, b.id, { amount: 1 }, prisma)).rejects.toMatchObject({ status: 404, code: "budget.not_found" });
    expect(Number((await prisma.budget.findUniqueOrThrow({ where: { id: b.id } })).amount)).toBe(500);
  });
});

describe("deactivateBudget", () => {
  it("soft deletes one version and undoes", async () => {
    const b = await pfMercado(500);
    const gone = await deactivateBudget(USER, b.id, prisma);
    expect(gone).toMatchObject({ id: b.id, isActive: false });
    expect(gone.batchId).toBeTruthy();
    expect(await listBudgets(USER, prisma)).toEqual([]);

    await undoBatch(USER, gone.batchId!, prisma);
    expect((await listBudgets(USER, prisma)).map((x) => x.id)).toEqual([b.id]);
  });

  it("reports an unknown budget and keeps other users out", async () => {
    const b = await pfMercado(500);
    await expect(deactivateBudget(USER, "nope", prisma)).rejects.toMatchObject({ code: "budget.not_found" });
    await expect(deactivateBudget(OTHER, b.id, prisma)).rejects.toMatchObject({ code: "budget.not_found" });
  });
});

describe("endBudgetFrom and deleteBudgetChain", () => {
  it("reports an unknown budget", async () => {
    await expect(endBudgetFrom(USER, "nope", "2026-06", prisma)).rejects.toMatchObject({ status: 404, code: "budget.not_found" });
    await expect(deleteBudgetChain(USER, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "budget.not_found" });
  });

  it("does not touch another user's budget", async () => {
    const b = await pfMercado(500);
    await expect(endBudgetFrom(OTHER, b.id, "2026-06", prisma)).rejects.toMatchObject({ code: "budget.not_found" });
    await expect(deleteBudgetChain(OTHER, b.id, prisma)).rejects.toMatchObject({ code: "budget.not_found" });
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: b.id } })).isActive).toBe(true);
  });
});

describe("listBudgets", () => {
  it("filters by entity (null included) and category", async () => {
    const pf = await pfMercado(500);
    const all = await createBudget(USER, { entityId: null, categoryId: mercado, amount: 100, effectiveFrom: "2026-01" }, prisma);
    const pjViagens = await createBudget(USER, { entityId: f.pjId, categoryId: viagens, amount: 300, effectiveFrom: "2026-01" }, prisma);
    const ids = async (filters: Parameters<typeof listBudgets>[2]) => (await listBudgets(USER, prisma, filters)).map((b) => b.id).sort();

    expect(await ids({})).toEqual([pf.id, all.id, pjViagens.id].sort());
    expect(await ids({ entityId: null })).toEqual([all.id]);
    expect(await ids({ entityId: f.pfId })).toEqual([pf.id]);
    expect(await ids({ categoryId: viagens })).toEqual([pjViagens.id]);
    expect(await ids({ entityId: f.pfId, categoryId: viagens })).toEqual([]);
  });

  it("lists the versions in force at a date", async () => {
    const jan = await pfMercado(500);
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    const all = await createBudget(USER, { entityId: null, categoryId: mercado, amount: 100, effectiveFrom: "2026-01" }, prisma);

    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-03" })).map((b) => b.id).sort()).toEqual([jan.id, all.id].sort());
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-07-10" })).map((b) => b.id).sort()).toEqual([jun.id, all.id].sort());
    expect((await listBudgets(USER, prisma, { effectiveAt: "2025-12" })).map((b) => b.id)).toEqual([]);
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-07", entityId: null })).map((b) => b.id)).toEqual([all.id]);
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-07", categoryId: viagens })).map((b) => b.id)).toEqual([]);
  });

  it("leaves tombstones and inactive rows out", async () => {
    const jan = await pfMercado(500);
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    await endBudgetFrom(USER, jun.id, "2026-09", prisma);
    const off = await createBudget(USER, { entityId: f.pjId, categoryId: mercado, amount: 1, effectiveFrom: "2026-01" }, prisma);
    await deactivateBudget(USER, off.id, prisma);

    expect(await prisma.budget.count({ where: { userId: USER, isTombstone: true } })).toBe(1);
    expect((await listBudgets(USER, prisma)).map((b) => b.id).sort()).toEqual([jan.id, jun.id].sort());
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-10" })).map((b) => b.id)).toEqual([]);
  });

  it("never lists another user's budgets", async () => {
    await pfMercado(500);
    expect(await listBudgets(OTHER, prisma)).toEqual([]);
    expect(await listBudgets(OTHER, prisma, { effectiveAt: "2026-03" })).toEqual([]);
  });
});

describe("serializeBudget", () => {
  it("returns a numeric amount, a YYYY-MM-DD start and the category name", async () => {
    const created = await createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount: 1234.56, effectiveFrom: "2026-09-22", notes: "x" }, prisma);
    const [row] = await listBudgets(USER, prisma);
    expect(serializeBudget(row)).toEqual({
      id: created.id,
      entityId: f.pfId,
      categoryId: mercado,
      category: "Mercado",
      amount: 1234.56,
      currency: "USD",
      period: "monthly",
      effectiveFrom: "2026-09-01",
      rollover: false,
      isActive: true,
      isTombstone: false,
      notes: "x",
    });
    expect(typeof serializeBudget(row).amount).toBe("number");
  });
});
