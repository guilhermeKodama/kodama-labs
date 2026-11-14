import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createBudget } from "../budget-crud";
import { monthOverview, yearOverview } from "../budget-overview";

const USER = "test-user-budgets-overview-branches-001";
let f: LedgerFixture;
let c: Record<string, string>;

const setNow = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

beforeEach(async () => {
  setNow("2026-09-22T15:00:00Z");
  f = await createLedgerFixture(prisma, USER, {
    categories: [...["Mercado", "Lazer", "Moradia", "Viagens", "Saude"].map((name) => ({ name, type: "expense" as const })), { name: "Salario", type: "income" as const }],
  });
  c = f.categories;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const budget = (categoryId: string, amount: number, extra: Record<string, unknown> = {}) =>
  createBudget(USER, { categoryId, amount, effectiveFrom: "2026-01", ...extra } as never, prisma);
const spend = (categoryId: string | null, amount: number, date: string, accountId = f.pfChecking, description = "Compra") =>
  createEntry(USER, { kind: "expense", accountId, amount, date, description, categoryId }, prisma, { skipRules: true });

describe("monthOverview in other months", () => {
  it("spends nothing yet in a future month: no days elapsed, a flat projection, a zero-pace series", async () => {
    await budget(c.Mercado, 600);
    await spend(c.Mercado, 90, "2026-11-10");
    const o = await monthOverview(USER, 2026, 11, prisma);
    expect(o.period).toMatchObject({ daysElapsed: 0, isCurrent: false, isPast: false, daysInMonth: 30 });
    expect(o.series).toEqual([]);
    expect(o.budgets[0]).toMatchObject({ spent: 0, committed: 90, status: "on_track", percentUsed: 0 });
    expect(o.budgets[0].pace).toMatchObject({ dailySpendRate: 0, projectedTotal: 90, daysRemaining: 30, isOverPace: false });
  });

  it("reads a past month in full: every day elapsed, the whole month spent", async () => {
    await budget(c.Mercado, 300);
    await spend(c.Mercado, 400, "2026-07-30");
    const o = await monthOverview(USER, 2026, 7, prisma);
    expect(o.period).toMatchObject({ isPast: true, isCurrent: false, daysElapsed: 31 });
    expect(o.series).toHaveLength(31);
    expect(o.series[30].cumulative).toBe(400);
    expect(o.budgets[0]).toMatchObject({ spent: 400, isOverBudget: true, status: "over", remaining: -100 });
    expect(o.insights[0]).toMatchObject({ severity: "critical", category: "Mercado" });
  });

  it("handles January, whose previous month is December of the year before", async () => {
    await budget(c.Mercado, 500, { rollover: true, effectiveFrom: "2025-12" });
    await spend(c.Mercado, 120, "2025-12-20");
    const o = await monthOverview(USER, 2026, 1, prisma);
    expect(o.budgets[0]).toMatchObject({ carry: 380, available: 880 });
    expect(o.monthOverMonth[0]).toMatchObject({ previousSpent: 120, currentSpent: 0, changeAmount: -120, changePercent: -100 });
  });
});

describe("monthOverview budgets", () => {
  it("shows a zero budget as 0% used, over budget as soon as anything is spent", async () => {
    await budget(c.Lazer, 0);
    await spend(c.Lazer, 10, "2026-09-05");
    const row = (await monthOverview(USER, 2026, 9, prisma)).budgets[0];
    expect(row).toMatchObject({ amount: 0, percentUsed: 0, isOverBudget: true, status: "over" });
  });

  it("flags a budget ahead of pace as a warning, and a calm one as good", async () => {
    await budget(c.Mercado, 1000);
    await budget(c.Moradia, 1000);
    await spend(c.Mercado, 900, "2026-09-02"); // 90% used by day 22 of 30 (73% of the month)
    await spend(c.Moradia, 100, "2026-09-02");
    const o = await monthOverview(USER, 2026, 9, prisma);
    const by = (name: string) => o.budgets.find((b) => b.category === name)!;
    expect(by("Mercado")).toMatchObject({ status: "ahead_of_pace", isOverBudget: false, percentUsed: 90 });
    expect(by("Moradia")).toMatchObject({ status: "on_track" });
    expect(o.insights.map((i) => [i.category, i.severity])).toEqual([
      ["Mercado", "warning"],
      ["Moradia", "good"],
    ]);
  });

  it("orders the rows by entity: every entity first, then PF, then businesses, then by name", async () => {
    await budget(c.Mercado, 100, { entityId: f.pjId });
    await budget(c.Lazer, 100, { entityId: f.pfId });
    await budget(c.Viagens, 100, { entityId: null });
    await budget(c.Saude, 100, { entityId: f.pfId });
    const o = await monthOverview(USER, 2026, 9, prisma);
    expect(o.budgets.map((b) => b.category)).toEqual(["Viagens", "Lazer", "Saude", "Mercado"]);
  });

  it("lists spend no budget covers, biggest first, with uncategorized spend as a null category", async () => {
    await budget(c.Mercado, 100);
    await spend(c.Saude, 40, "2026-09-03");
    await spend(c.Moradia, 90, "2026-09-04");
    await spend(null, 15, "2026-09-05");
    const o = await monthOverview(USER, 2026, 9, prisma);
    expect(o.unbudgeted.map((u) => [u.category, u.spent, u.count])).toEqual([
      ["Moradia", 90, 1],
      ["Saude", 40, 1],
      [null, 15, 1],
    ]);
  });

  it("carries only what was left over, and none when the previous month overspent or had no budget", async () => {
    await budget(c.Mercado, 500, { rollover: true, effectiveFrom: "2026-07" });
    await budget(c.Lazer, 100, { rollover: true, effectiveFrom: "2026-09" });
    await spend(c.Mercado, 600, "2026-08-10"); // overspent: nothing carried
    await spend(c.Lazer, 10, "2026-08-10");
    const o = await monthOverview(USER, 2026, 9, prisma);
    expect(o.budgets.find((b) => b.category === "Mercado")).toMatchObject({ carry: 0, available: 500 });
    // Lazer had no budget in August.
    expect(o.budgets.find((b) => b.category === "Lazer")).toMatchObject({ carry: 0, available: 100 });
  });

  it("converts an income assigned to the category to a reimbursement of the previous month's carry", async () => {
    await budget(c.Mercado, 500, { rollover: true, effectiveFrom: "2026-07" });
    await spend(c.Mercado, 300, "2026-08-10");
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 100, date: "2026-08-12", description: "Reembolso", categoryId: c.Salario, reimbursesCategoryId: c.Mercado }, prisma, { skipRules: true });
    const row = (await monthOverview(USER, 2026, 9, prisma)).budgets[0];
    expect(row.carry).toBe(300); // 500 - (300 - 100)
  });
});

describe("yearly budgets in the month overview", () => {
  it("is zero percent used for a yearly budget of nothing, and counts reimbursements", async () => {
    await budget(c.Viagens, 0, { period: "yearly" });
    await budget(c.Saude, 1000, { period: "yearly" });
    await spend(c.Saude, 300, "2026-03-05");
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 50, date: "2026-04-05", description: "Plano", categoryId: c.Salario, reimbursesCategoryId: c.Saude }, prisma, { skipRules: true });
    const o = await monthOverview(USER, 2026, 9, prisma);
    const by = (name: string) => o.yearlyBudgets.find((b) => b.category === name)!;
    expect(by("Viagens")).toMatchObject({ amount: 0, percentUsed: 0, spent: 0 });
    expect(by("Saude")).toMatchObject({ spent: 300, reimbursed: 50, net: 250, percentUsed: 25, committed: 300 });
  });

  it("paces a past year as complete and a future year as not started", async () => {
    await budget(c.Viagens, 1000, { period: "yearly", effectiveFrom: "2025-01" });
    expect((await monthOverview(USER, 2025, 12, prisma)).yearlyBudgets[0].yearPace).toBe(1);
    await budget(c.Saude, 1000, { period: "yearly", effectiveFrom: "2027-01" });
    expect((await monthOverview(USER, 2027, 1, prisma)).yearlyBudgets[0].yearPace).toBe(0);
  });
});

describe("upcoming bills", () => {
  it("lists rules due in the window, a declared statement total, a statement of purchases, and drops the empty ones", async () => {
    const rule = await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "expense", amount: 80, currency: "BRL", description: "Internet", frequency: "monthly", startDate: new Date("2026-01-05T12:00:00Z"), nextDueDate: new Date("2026-09-25T12:00:00Z") },
    });
    await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "expense", amount: 20, currency: "BRL", description: "Encerrada", frequency: "monthly", startDate: new Date("2026-01-05T12:00:00Z"), endDate: new Date("2026-09-10T12:00:00Z"), nextDueDate: new Date("2026-09-25T12:00:00Z") },
    });
    // A card with purchases on its open statement, due soon.
    await spend(c.Mercado, 250, "2026-09-03", f.card);
    const withPurchases = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } });
    await prisma.cardStatement.update({ where: { id: withPurchases.id }, data: { dueDate: new Date("2026-09-28T12:00:00Z") } });
    // A second card whose bill declares its own total, one with nothing to pay and one with no due date.
    const declared = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Inter", currency: "BRL", closingDay: 5, dueDay: 12, creditLimit: 1000 } });
    await prisma.cardStatement.create({ data: { accountId: declared.id, month: "2026-09", totalAmount: 480.5, dueDate: new Date("2026-09-25T12:00:00Z") } });
    const empty = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Vazio", currency: "BRL", closingDay: 5, dueDay: 12, creditLimit: 1000 } });
    await prisma.cardStatement.create({ data: { accountId: empty.id, month: "2026-09", dueDate: new Date("2026-09-26T12:00:00Z") } });
    const undated = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Sem data", currency: "BRL", closingDay: 5, dueDay: 12, creditLimit: 1000 } });
    await prisma.cardStatement.create({ data: { accountId: undated.id, month: "2026-09", totalAmount: 99, dueDate: null } });

    const { upcoming } = await monthOverview(USER, 2026, 9, prisma);
    // Same day: by description. "Inter" (the statement) sorts before "Internet" (the rule).
    expect(upcoming.map((u) => [u.description, u.amount, u.source, u.dueDate])).toEqual([
      ["Inter", 480.5, "statement", "2026-09-25"],
      ["Internet", 80, "rule", "2026-09-25"],
      ["Nubank", 250, "statement", "2026-09-28"],
    ]);
    expect(upcoming[1]).toMatchObject({ id: rule.id, mode: "auto", overdue: false, kind: "expense" });
    expect(upcoming[0]).toMatchObject({ mode: "fatura", kind: "card_bill", month: "2026-09" });
  });

  it("flags an overdue reminder and an overdue statement, ties broken by name", async () => {
    await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "expense", amount: 10, currency: "BRL", description: "Zeladoria", frequency: "monthly", autoGenerate: false, startDate: new Date("2026-01-05T12:00:00Z"), nextDueDate: new Date("2026-09-20T12:00:00Z") },
    });
    await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "expense", amount: 10, currency: "BRL", description: "Agua", frequency: "monthly", startDate: new Date("2026-01-05T12:00:00Z"), nextDueDate: new Date("2026-09-20T12:00:00Z") },
    });
    const o = (await monthOverview(USER, 2026, 9, prisma)).upcoming;
    expect(o.map((u) => [u.description, u.overdue, u.mode])).toEqual([
      ["Agua", true, "auto"],
      ["Zeladoria", true, "reminder"],
    ]);
  });
});

describe("yearOverview", () => {
  it("treats a past year as complete and projects nothing", async () => {
    await budget(c.Mercado, 100, { effectiveFrom: "2025-01" });
    await spend(c.Mercado, 120, "2025-02-10");
    const y = await yearOverview(USER, 2025, prisma);
    expect(y.period).toMatchObject({ isPast: true, nElapsed: 12, completeMonths: 12, projectionBasis: null, yearPace: 1 });
    expect(y.currentMonth).toBe(12);
    expect(y.categories[0].months.every((m) => !m.isProjected)).toBe(true);
    expect(y.categories[0].months[1]).toMatchObject({ spent: 120, percentUsed: 120 });
  });

  it("projects a whole future year from nothing: zeros, no elapsed months, no insights", async () => {
    await budget(c.Mercado, 100, { effectiveFrom: "2027-01" });
    const y = await yearOverview(USER, 2027, prisma);
    expect(y.period).toMatchObject({ nElapsed: 0, completeMonths: 0, isPast: false, yearPace: 0, projectionBasis: null });
    expect(y.currentMonth).toBe(0);
    expect(y.categories[0].months.every((m) => m.isProjected)).toBe(true);
    expect(y.categories[0].overMonths).toBe(0);
    expect(y.insights).toEqual([]);
    expect(y.summary).toMatchObject({ spentToDate: 0, budgetToDate: 0 });
  });

  it("in January the month in progress is the only month: the average is the spend so far", async () => {
    setNow("2026-01-20T15:00:00Z");
    await budget(c.Mercado, 100);
    await spend(c.Mercado, 300, "2026-01-10");
    const y = await yearOverview(USER, 2026, prisma);
    expect(y.period).toMatchObject({ nElapsed: 1, completeMonths: 0, projectionBasis: null });
    expect(y.insights).toHaveLength(1);
    expect(y.insights[0]).toMatchObject({ kind: "seasonal", avg: 300, suggested: 300, first3: null, last3: null, growth: null, peakMonth: 1, peakValue: 300 });
  });

  it("lands a month with no budget in force on the row of its slot: the entity's own, else the one for every entity", async () => {
    await budget(c.Mercado, 100, { entityId: f.pfId, effectiveFrom: "2026-06" });
    await budget(c.Lazer, 100, { entityId: null, effectiveFrom: "2026-06" });
    await spend(c.Mercado, 70, "2026-02-10");
    await spend(c.Lazer, 40, "2026-03-10", f.pjChecking);
    const y = await yearOverview(USER, 2026, prisma);
    const row = (name: string) => y.categories.find((r) => r.category === name)!;
    expect(row("Mercado").months[1]).toMatchObject({ spent: 70, budget: null });
    expect(row("Lazer").months[2]).toMatchObject({ spent: 40, budget: null });
    expect(row("Mercado").months[5].budget).toBe(100);
  });

  it("adds a row per unbudgeted slot when asked, except the ones a yearly budget covers", async () => {
    await budget(c.Mercado, 100);
    await budget(c.Viagens, 5000, { period: "yearly" });
    await spend(c.Moradia, 900, "2026-02-10");
    await spend(c.Moradia, 100, "2026-03-10", f.pjChecking);
    await spend(c.Viagens, 800, "2026-02-12");
    await spend(null, 25, "2026-02-14");
    const onlyBudgeted = await yearOverview(USER, 2026, prisma);
    expect(onlyBudgeted.categories.map((r) => r.category)).toEqual(["Mercado"]);
    const all = await yearOverview(USER, 2026, prisma, { onlyBudgeted: false });
    // Budgeted rows first, then the others by entity (PF before the business) and category name (uncategorized first).
    expect(all.categories.map((r) => [r.category, r.isBudgeted, r.entityId])).toEqual([
      ["Mercado", true, null],
      [null, false, f.pfId],
      ["Moradia", false, f.pfId],
      ["Moradia", false, f.pjId],
    ]);
    const moradia = all.categories.filter((r) => r.category === "Moradia");
    expect(moradia).toHaveLength(2);
    expect(moradia.every((r) => r.budget === null && r.kind === null && r.budgetId === null)).toBe(true);
    expect(all.yearlyBudgets[0]).toMatchObject({ category: "Viagens", spent: 800 });
  });

  it("projects the rest of the year from the median of the complete months, and reads growth and overruns", async () => {
    await budget(c.Mercado, 100);
    for (const [month, amount] of [["01", 50], ["02", 60], ["03", 150], ["04", 160], ["05", 170], ["06", 180], ["07", 190], ["08", 200]] as const) await spend(c.Mercado, amount, `2026-${month}-10`);
    const y = await yearOverview(USER, 2026, prisma);
    const row = y.categories[0];
    expect(row.months[8].isPartial).toBe(true);
    expect(row.months[9]).toMatchObject({ isProjected: true });
    // The median of the last six complete months, 150..200, is 175.
    expect(row.months[9].spent).toBe(175);
    expect(row.overMonths).toBe(6); // March to August
    // Median of Jun–Aug (190) over the median of Mar–May (160). The old mean of Jan–Mar against Jun–Aug was +119%.
    expect(row.trend).toBe(0.1875);
    expect(y.insights[0]).toMatchObject({ kind: "overrun", category: "Mercado", overMonths: 6, avg: 145, suggested: 150, first3: 160, last3: 190 });
    expect(y.period.projectionBasis).toEqual([3, 8]);
    expect(y.summary.overBudgetMonths).toBe(row.overMonths);
  });

  it("does not project a negative month from a run of refunds", async () => {
    await budget(c.Mercado, 500);
    for (const month of ["01", "02", "03", "04"]) await spend(c.Mercado, -2000, `2026-${month}-10`);
    await spend(c.Mercado, 100, "2026-05-10");
    await spend(c.Mercado, 120, "2026-06-10");
    const y = await yearOverview(USER, 2026, prisma);
    const future = y.categories[0].months.filter((m) => m.isProjected);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((m) => m.spent >= 0)).toBe(true);
    // May and June were 100 and 120; July and August were quiet. The median of that window is 50, not the refunds.
    expect(future[0].spent).toBe(50);
  });

  it("is net of reimbursements like Mensal, ends the running month at its projection, and compares spend and budget over the same months", async () => {
    // Budget only from July; spend since January. Today is 22/set.
    await budget(c.Moradia, 1000, { effectiveFrom: "2026-07", kind: "fixo" });
    for (const month of ["01", "02", "03", "04", "05", "06", "07", "08"]) await spend(c.Moradia, 1000, `2026-${month}-20`);
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 300, date: "2026-08-21", description: "Reembolso", categoryId: c.Salario, reimbursesCategoryId: c.Moradia }, prisma, { skipRules: true });
    await spend(c.Moradia, 200, "2026-09-03");

    const y = await yearOverview(USER, 2026, prisma);
    const row = y.categories[0];
    const month = await monthOverview(USER, 2026, 9, prisma);
    // August is líquido: 1,000 spent, 300 reimbursed.
    expect(row.months[7]).toMatchObject({ spent: 700, projected: 700 });
    // September shows 200 to date and ends where Mensal says it will.
    expect(row.months[8]).toMatchObject({ spent: 200, isPartial: true });
    expect(row.months[8].projected).toBe(month.budgets[0].pace.projectedTotal);
    expect(row.months[8].projected).toBe(1000);
    expect(y.monthProjected[8]).toBe(1000);
    expect(row.yearTotal).toBe(y.summary.projectedYear);
    // Spend of jul–set (1,000 + 700 + 200) against the budget of jul–set (3,000); January to June had no budget.
    expect(y.summary).toMatchObject({ budgetedMonths: [7, 8, 9], spentInBudgetedMonths: 1900, budgetToDate: 3000, budgetedSpan: { from: 7, to: 9, contiguous: true, count: 3 } });
    expect(y.summary.spentToDate).toBe(7 * 1000 + 700 + 200);
  });

  it("reports growth when the last three months outrun the three before them, without overruns", async () => {
    await budget(c.Mercado, 2000);
    for (const [month, amount] of [["01", 100], ["02", 100], ["03", 100], ["04", 120], ["05", 130], ["06", 140], ["07", 150], ["08", 160]] as const) await spend(c.Mercado, amount, `2026-${month}-10`);
    const y = await yearOverview(USER, 2026, prisma);
    expect(y.insights).toHaveLength(1);
    expect(y.insights[0]).toMatchObject({ kind: "growth", overMonths: 0 });
    expect(y.insights[0].growth).toBeGreaterThan(0.12);
    expect(y.categories[0].trend).toBe(y.insights[0].growth);
  });

  it("raises no insight for a steady series that stays under its budget", async () => {
    await budget(c.Mercado, 1000);
    for (const [month, amount] of [["01", 400], ["02", 410], ["03", 405], ["04", 400], ["05", 410], ["06", 405], ["07", 400], ["08", 410]] as const) await spend(c.Mercado, amount, `2026-${month}-10`);
    await spend(c.Mercado, 50, "2026-09-03"); // the month in progress stays out of the trend
    const y = await yearOverview(USER, 2026, prisma);
    expect(y.insights).toEqual([]);
    expect(y.categories[0].trend).toBe(0);
    expect(y.categories[0].overMonths).toBe(0);
  });

  it("counts reimbursements of yearly budgets and scopes the rows to the entities asked for", async () => {
    await budget(c.Mercado, 100, { entityId: f.pfId });
    await budget(c.Lazer, 100, { entityId: f.pjId });
    await budget(c.Viagens, 1000, { period: "yearly", entityId: f.pfId });
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 200, date: "2026-05-01", description: "Reembolso", categoryId: c.Salario, reimbursesCategoryId: c.Viagens }, prisma, { skipRules: true });
    await spend(c.Viagens, 600, "2026-05-02");
    const pf = await yearOverview(USER, 2026, prisma, { entityIds: [f.pfId] });
    expect(pf.categories.map((r) => r.category)).toEqual(["Mercado"]);
    expect(pf.yearlyBudgets[0]).toMatchObject({ spent: 600, reimbursed: 200, net: 400, percentUsed: 40 });
    const pj = await yearOverview(USER, 2026, prisma, { entityIds: [f.pjId] });
    expect(pj.categories.map((r) => r.category)).toEqual(["Lazer"]);
    expect(pj.yearlyBudgets).toEqual([]);
  });
});
