import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { createBudget, deleteBudgetChain, endBudgetFrom, listBudgets, updateBudget } from "../budget-crud";
import { monthOverview, yearOverview } from "../budget-overview";

const USER = "test-user-s5-budget-versions-001";
let f: LedgerFixture;
let mercado: string;
let viagens: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Mercado", type: "expense" }, { name: "Viagens", type: "expense" }] });
  mercado = f.categories.Mercado;
  viagens = f.categories.Viagens;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const pfMercado = (amount: number, effectiveFrom = "2026-01") => createBudget(USER, { entityId: f.pfId, categoryId: mercado, amount, effectiveFrom }, prisma);
/** The monthly Mercado budget in force in each month of 2026 (null = none). */
const budgetsByMonth = async () => (await yearOverview(USER, 2026, prisma)).categories.find((r) => r.categoryId === mercado)?.months.map((m) => m.budget) ?? [];
const months = (...parts: [number | null, number][]) => parts.flatMap(([v, n]) => Array<number | null>(n).fill(v));

describe("editing with applyFrom", () => {
  it("keeps January to August when the amount changes from September, and undoes", async () => {
    const jan = await pfMercado(500);
    const sep = await updateBudget(USER, jan.id, { amount: 700, applyFrom: "2026-09" }, prisma);
    expect(sep.id).not.toBe(jan.id);
    expect(sep).toMatchObject({ period: "monthly", month: 9, year: 2026, entityId: f.pfId, categoryId: mercado });
    expect(await budgetsByMonth()).toEqual(months([500, 8], [700, 4]));
    expect((await monthOverview(USER, 2026, 8, prisma)).budgets[0]).toMatchObject({ id: jan.id, amount: 500 });
    expect((await monthOverview(USER, 2026, 9, prisma)).budgets[0]).toMatchObject({ id: sep.id, amount: 700, effectiveFrom: "2026-09-01" });

    // Same month as the version: in place, with a note.
    const again = await updateBudget(USER, sep.id, { amount: 750, applyFrom: "2026-09", notes: "subiu o aluguel" }, prisma);
    expect(again).toMatchObject({ id: sep.id, notes: "subiu o aluguel" });
    expect(await budgetsByMonth()).toEqual(months([500, 8], [750, 4]));
    await expect(updateBudget(USER, sep.id, { amount: 1, applyFrom: "2026-08" }, prisma)).rejects.toMatchObject({ status: 422, code: "budget.apply_before_start" });

    await undoBatch(USER, again.batchId!, prisma);
    await undoBatch(USER, sep.batchId!, prisma);
    expect(await budgetsByMonth()).toEqual(months([500, 12]));
    expect(await prisma.budget.count({ where: { id: sep.id } })).toBe(0);
  });

  it("changes a later version that already exists instead of adding another", async () => {
    const jan = await pfMercado(500);
    const dec = await pfMercado(900, "2026-12");
    const edited = await updateBudget(USER, jan.id, { amount: 950, applyFrom: "2026-12" }, prisma);
    expect(edited.id).toBe(dec.id);
    expect(await budgetsByMonth()).toEqual(months([500, 11], [950, 1]));
    // Without applyFrom (the MCP contract) the version changes in place, past months included.
    await updateBudget(USER, jan.id, { amount: 450 }, prisma);
    expect(await budgetsByMonth()).toEqual(months([450, 11], [950, 1]));
  });

  it("versions yearly budgets by year", async () => {
    const y2026 = await createBudget(USER, { entityId: f.pfId, categoryId: viagens, amount: 25000, period: "yearly", effectiveFrom: "2026-01" }, prisma);
    const sameYear = await updateBudget(USER, y2026.id, { amount: 26000, applyFrom: "2026-09" }, prisma);
    expect(sameYear.id).toBe(y2026.id);
    const y2027 = await updateBudget(USER, y2026.id, { amount: 30000, applyFrom: "2027-03" }, prisma);
    expect(y2027).toMatchObject({ period: "yearly", month: null, year: 2027 });
    expect(y2027.effectiveFrom.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect((await yearOverview(USER, 2026, prisma)).yearlyBudgets[0]).toMatchObject({ id: y2026.id, amount: 26000 });
    expect((await yearOverview(USER, 2027, prisma)).yearlyBudgets[0]).toMatchObject({ id: y2027.id, amount: 30000 });
  });
});

describe("deleting", () => {
  it("ends a budget from a month without bringing an older version back, and undoes", async () => {
    const jan = await pfMercado(500);
    const jun = await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    const ended = await endBudgetFrom(USER, jun.id, "2026-09", prisma);
    expect(ended.batchId).toBeTruthy();
    expect(await budgetsByMonth()).toEqual(months([500, 5], [800, 3], [null, 4]));
    expect((await monthOverview(USER, 2026, 10, prisma)).budgets).toEqual([]);
    // The tombstone is not a budget anyone lists.
    expect((await listBudgets(USER, prisma)).map((b) => b.id).sort()).toEqual([jan.id, jun.id].sort());
    expect((await listBudgets(USER, prisma, { effectiveAt: "2026-10" })).map((b) => b.id)).toEqual([]);

    await undoBatch(USER, ended.batchId!, prisma);
    expect(await budgetsByMonth()).toEqual(months([500, 5], [800, 7]));

    // Ending at the version's own month turns it into the tombstone.
    const fromJune = await endBudgetFrom(USER, jun.id, "2026-06", prisma);
    expect(fromJune).toMatchObject({ id: jun.id, isActive: true, isTombstone: true });
    expect(await budgetsByMonth()).toEqual(months([500, 5], [null, 7]));

    // Creating the budget again from that month revives the row.
    const back = await pfMercado(650, "2026-06");
    expect(back).toMatchObject({ id: jun.id, isTombstone: false });
    expect(await budgetsByMonth()).toEqual(months([500, 5], [650, 7]));
  });

  it("needs no tombstone when nothing older would come back, and later versions stop too", async () => {
    const jan = await pfMercado(500);
    const oct = await pfMercado(600, "2026-10");
    const ended = await endBudgetFrom(USER, jan.id, "2026-01", prisma);
    expect(await prisma.budget.count({ where: { userId: USER, isTombstone: true } })).toBe(0);
    expect(await prisma.budget.findMany({ where: { id: { in: [jan.id, oct.id] } }, select: { isActive: true } })).toEqual([{ isActive: false }, { isActive: false }]);
    expect(await budgetsByMonth()).toEqual([]);
    await undoBatch(USER, ended.batchId!, prisma);
    expect(await budgetsByMonth()).toEqual(months([500, 9], [600, 3]));
  });

  it("deletes every version with ?all, and undoes", async () => {
    const jan = await pfMercado(500);
    await updateBudget(USER, jan.id, { amount: 800, applyFrom: "2026-06" }, prisma);
    const gone = await deleteBudgetChain(USER, jan.id, prisma);
    expect(await budgetsByMonth()).toEqual([]);
    expect((await prisma.mutationRecord.findMany({ where: { batchId: gone.batchId! } })).length).toBe(2);
    await undoBatch(USER, gone.batchId!, prisma);
    expect(await budgetsByMonth()).toEqual(months([500, 5], [800, 7]));
  });
});

describe("monthly and yearly budgets", () => {
  it("live side by side for the same category and month", async () => {
    const monthly = await createBudget(USER, { entityId: f.pfId, categoryId: viagens, amount: 1000, effectiveFrom: "2026-01" }, prisma);
    const yearly = await createBudget(USER, { entityId: f.pfId, categoryId: viagens, amount: 12000, effectiveFrom: "2026-01", period: "yearly" }, prisma);
    expect(yearly.id).not.toBe(monthly.id);
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 300, date: "2026-02-10", description: "Hotel", categoryId: viagens }, prisma);
    const feb = await monthOverview(USER, 2026, 2, prisma);
    expect(feb.budgets).toEqual([expect.objectContaining({ id: monthly.id, spent: 300 })]);
    expect(feb.yearlyBudgets).toEqual([expect.objectContaining({ id: yearly.id, spent: 300 })]);

    // Ending the yearly one leaves the monthly chain alone.
    await endBudgetFrom(USER, yearly.id, "2026-05", prisma);
    const after = await monthOverview(USER, 2026, 2, prisma);
    expect(after.budgets.map((b) => b.id)).toEqual([monthly.id]);
    expect(after.yearlyBudgets).toEqual([]);
  });
});
