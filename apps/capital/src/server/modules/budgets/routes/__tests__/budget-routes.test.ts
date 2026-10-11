import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-s5-budget-routes-001";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Mercado", type: "expense" }, { name: "Lazer", type: "expense" }, { name: "Salário", type: "income" }] });
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await prisma.budget.deleteMany({ where: { userId: USER } });
  await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
  await prisma.transferGroup.deleteMany({ where: { userId: USER } });
  await prisma.recurringRule.deleteMany({ where: { userId: USER } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (method: string, path: string, body?: unknown, status = 200) => {
  const res = await call(method, path, body);
  expect(res.status).toBe(status);
  return res.json();
};
const amounts = async () =>
  (await json("GET", "/v2/budgets/overview?year=2026")).categories[0]?.months.map((m: { budget: number | null }) => m.budget) ?? [];

describe("budget routes", () => {
  it("names the category when a budget already starts in that month", async () => {
    await json("POST", "/v2/budgets", { entityId: f.pfId, categoryId: f.categories.Mercado, amount: 500, effectiveFrom: "2026-09" });
    const clash = await json("POST", "/v2/budgets", { entityId: f.pfId, categoryId: f.categories.Mercado, amount: 800, effectiveFrom: "2026-09" }, 409);
    expect(clash).toMatchObject({ code: "budget.clash", params: { category: "Mercado" } });
  });

  it("edits from a month on (applyFrom), ends from a month (?from), deletes every version (?all), each undoable", async () => {
    const created = await json("POST", "/v2/budgets", { entityId: f.pfId, categoryId: f.categories.Mercado, amount: 500, effectiveFrom: "2026-01", notes: "  feira e mercado  " });
    expect(created).toMatchObject({ notes: "feira e mercado", isTombstone: false, batchId: expect.any(String) });

    const edited = await json("PATCH", `/v2/budgets/${created.id}`, { amount: 700, applyFrom: "2026-09" });
    expect(edited).toMatchObject({ effectiveFrom: "2026-09-01", amount: 700, notes: "feira e mercado", batchId: expect.any(String) });
    expect(edited.id).not.toBe(created.id);
    expect(await amounts()).toEqual([...Array(8).fill(500), ...Array(4).fill(700)]);

    const bad = await json("PATCH", `/v2/budgets/${edited.id}`, { amount: 1, applyFrom: "2026-10", effectiveFrom: "2026-03" }, 422);
    expect(bad).toMatchObject({ code: "validation", issues: [expect.objectContaining({ path: "effectiveFrom" })] });
    expect(await json("PATCH", `/v2/budgets/${edited.id}`, { amount: 1, applyFrom: "2026-02" }, 422)).toMatchObject({ code: "budget.apply_before_start" });

    const ended = await json("DELETE", `/v2/budgets/${edited.id}?from=2026-11`);
    expect(ended.batchId).toEqual(expect.any(String));
    expect(await amounts()).toEqual([...Array(8).fill(500), 700, 700, null, null]);
    await json("POST", `/v2/mutations/${ended.batchId}/undo`);
    expect(await amounts()).toEqual([...Array(8).fill(500), ...Array(4).fill(700)]);

    const gone = await json("DELETE", `/v2/budgets/${created.id}?all=true`);
    expect(await amounts()).toEqual([]);
    await json("POST", `/v2/mutations/${gone.batchId}/undo`);
    expect(await amounts()).toEqual([...Array(8).fill(500), ...Array(4).fill(700)]);
    await json("POST", `/v2/mutations/${edited.batchId}/undo`);
    expect(await amounts()).toEqual(Array(12).fill(500));
  });

  it("serves the month (today, faturas, scope) and the year (onlyBudgeted)", async () => {
    await json("POST", "/v2/budgets", { categoryId: f.categories.Mercado, amount: 1000, effectiveFrom: "2026-01" });
    await json("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, categoryId: f.categories.Mercado, amount: 120, date: "2026-09-10", description: "Feira" });
    await json("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pjChecking, categoryId: f.categories.Lazer, amount: 80, date: "2026-09-10", description: "Happy hour" });
    await json("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.card, categoryId: f.categories.Lazer, amount: 60, date: "2026-09-20", description: "Cinema" }); // statement 2026-10, due 12/10

    const month = await json("GET", "/v2/budgets/overview?month=2026-09&scope=pf");
    expect(month.period).toMatchObject({ today: "2026-09-22", daysElapsed: 22 });
    expect(month.scope.entityIds).toEqual([f.pfId]);
    expect(month.budgets).toEqual([expect.objectContaining({ spent: 120, excludeEntityIds: [] })]);
    // The October statement is due on 12/10, outside 14 days of 22/09.
    expect(month.upcoming).toEqual([]);
    expect(month.series).toHaveLength(22);

    const year = await json("GET", "/v2/budgets/overview?year=2026");
    expect(year.categories).toHaveLength(1);
    const all = await json("GET", "/v2/budgets/overview?year=2026&onlyBudgeted=false");
    // Unbudgeted spend gets a row per (entity, category): PF's card purchase (October) and PJ's.
    expect(all.categories.map((r: { entityId: string | null; categoryId: string; isBudgeted: boolean }) => [r.entityId, r.categoryId, r.isBudgeted])).toEqual([
      [null, f.categories.Mercado, true],
      [f.pfId, f.categories.Lazer, false],
      [f.pjId, f.categories.Lazer, false],
    ]);
  });
});

describe("recurring routes", () => {
  it("creates a rule that books what is due, lists it with its entity, and pays and skips undoably", async () => {
    const created = await json("POST", "/v2/recurring", {
      kind: "expense",
      accountId: f.pfChecking,
      amount: 55,
      description: "Internet",
      categoryId: f.categories.Lazer,
      isTaxDeductible: true,
      frequency: "monthly",
      startDate: "2026-08-22",
    });
    expect(created).toMatchObject({ nextDueDate: "2026-10-22", isTaxDeductible: true, entity: { id: f.pfId, name: "PF", kind: "personal" }, booked: { count: 2 } });
    await json("POST", `/v2/mutations/${created.batchId}/undo`);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(0);

    const rent = await json("POST", "/v2/recurring", { kind: "expense", accountId: f.pjChecking, amount: 3100, description: "DAS", frequency: "monthly", startDate: "2026-09-20", autoGenerate: false });
    expect(rent.booked.count).toBe(0);
    const list = await json("GET", "/v2/recurring?scope=pj");
    expect(list.rules.map((r: { description: string; nextDueDate: string; entity: { name: string } }) => [r.description, r.nextDueDate, r.entity.name])).toEqual([["DAS", "2026-09-20", "Kodama LTDA"]]);
    expect((await json("GET", "/v2/recurring?scope=pf")).rules).toEqual([]);

    const paid = await json("POST", `/v2/recurring/${rent.id}/pay`, {});
    expect(paid.rule.nextDueDate).toBe("2026-10-20");
    const skipped = await json("POST", `/v2/recurring/${rent.id}/skip`);
    expect(skipped.nextDueDate).toBe("2026-11-20");
    await json("POST", `/v2/mutations/${skipped.batchId}/undo`);
    await json("POST", `/v2/mutations/${paid.batchId}/undo`);
    expect((await json("GET", "/v2/recurring?scope=pj")).rules[0].nextDueDate).toBe("2026-09-20");
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(0);

    const patched = await json("PATCH", `/v2/recurring/${rent.id}`, { autoGenerate: true, endDate: "2026-12-31" });
    expect(patched).toMatchObject({ autoGenerate: true, endDate: "2026-12-31", nextDueDate: "2026-10-20", booked: { count: 1 } });
  });
});
