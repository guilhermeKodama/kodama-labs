import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { budgetDrill, monthPeriod } from "@/lib/budgets/drill";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { queryLedger } from "@capital/server/modules/ledger/services/query-engine";
import { markStatementPayment } from "@capital/server/modules/ledger/services/statements";
import { createRecurringRule } from "@capital/server/modules/recurring/services/recurring-rules";
import { createBudget } from "../budget-crud";
import { monthOverview, yearOverview } from "../budget-overview";

const USER = "test-user-s5-budget-overview-001";
const CATEGORIES = ["Mercado", "Software", "Lazer", "Saúde", "Moradia", "Viagens"].map((name) => ({ name, type: "expense" as const }));
let f: LedgerFixture;
let c: Record<string, string>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 22/set/2026, noon in São Paulo (the fixture user's timezone).
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
  f = await createLedgerFixture(prisma, USER, { categories: [...CATEGORIES, { name: "Salário", type: "income" }] });
  c = f.categories;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const spend = (accountId: string, categoryId: string, amount: number, date: string) =>
  createEntry(USER, { kind: "expense", accountId, amount, date, description: "Compra", categoryId }, prisma, { skipRules: true });

describe("scope", () => {
  it("applies the PF / PJ scope to the monthly budgets, the yearly ones, the series and the year matrix", async () => {
    await createBudget(USER, { categoryId: c.Mercado, amount: 1000, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { entityId: f.pjId, categoryId: c.Software, amount: 300, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { entityId: f.pfId, categoryId: c.Viagens, amount: 25000, period: "yearly", effectiveFrom: "2026-01", notes: "2 de 3 viagens feitas" }, prisma);
    await spend(f.pfChecking, c.Mercado, 100, "2026-09-10");
    await spend(f.pjChecking, c.Mercado, 50, "2026-09-11");
    await spend(f.pjChecking, c.Software, 70, "2026-09-12");
    await spend(f.pfChecking, c.Viagens, 1200, "2026-03-15");
    await spend(f.pfChecking, c.Viagens, 800, "2026-09-20");
    await spend(f.pfChecking, c.Viagens, 500, "2026-11-20"); // committed, not spent yet
    await spend(f.pfChecking, c.Mercado, 40, "2026-09-25"); // after today

    const pf = await monthOverview(USER, 2026, 9, prisma, { entityIds: [f.pfId] });
    expect(pf.period).toMatchObject({ daysElapsed: 22, daysInMonth: 30, today: "2026-09-22", isCurrent: true });
    expect(pf.budgets.map((b) => [b.categoryId, b.spent, b.committed])).toEqual([[c.Mercado, 100, 140]]);
    expect(pf.summary).toMatchObject({ totalBudget: 1000, totalSpent: 100 });
    expect(pf.yearlyBudgets).toEqual([expect.objectContaining({ categoryId: c.Viagens, amount: 25000, spent: 2000, committed: 2500, notes: "2 de 3 viagens feitas" })]);
    expect(pf.yearlyBudgets[0].yearPace).toBeCloseTo(265 / 365, 3);
    // Viagens has a yearly budget, so it is not "unbudgeted".
    expect(pf.unbudgeted).toEqual([]);
    // The series stops today, so the purchase on the 25th is not in it.
    expect(pf.series).toHaveLength(22);
    expect(pf.series.at(-1)).toMatchObject({ day: 22, cumulative: 100 });

    const pj = await monthOverview(USER, 2026, 9, prisma, { entityIds: [f.pjId] });
    expect(Object.fromEntries(pj.budgets.map((b) => [b.categoryId, b.spent]))).toEqual({ [c.Mercado]: 50, [c.Software]: 70 });
    expect(pj.yearlyBudgets).toEqual([]);
    expect(pj.series.at(-1)!.cumulative).toBe(120);

    const all = await monthOverview(USER, 2026, 9, prisma);
    expect(all.budgets.find((b) => b.categoryId === c.Mercado)!.spent).toBe(150);
    expect(all.series.at(-1)!.cumulative).toBe(220);
    expect(all.scope.entityIds).toBeNull();

    const yPf = await yearOverview(USER, 2026, prisma, { entityIds: [f.pfId] });
    expect(yPf.monthBudgets[8]).toBe(1000);
    expect(yPf.categories.map((r) => [r.entityId, r.categoryId])).toEqual([[null, c.Mercado]]);
    expect(yPf.categories[0].months[8]).toMatchObject({ spent: 100, isPartial: true, budget: 1000 });
    expect(yPf.yearlyBudgets).toEqual([expect.objectContaining({ categoryId: c.Viagens, spent: 2000, committed: 2500 })]);

    const yPj = await yearOverview(USER, 2026, prisma, { entityIds: [f.pjId] });
    expect(yPj.monthBudgets[8]).toBe(1300);
    expect(yPj.categories.map((r) => [r.entityId, r.categoryId])).toEqual([
      [null, c.Mercado],
      [f.pjId, c.Software],
    ]);
    expect(yPj.yearlyBudgets).toEqual([]);
    expect(yPj.summary).toMatchObject({ budgetToDate: 1300 * 9, budgetedCells: 18 });
    expect(yPj.period).toMatchObject({ nElapsed: 9, completeMonths: 8, projectionBasis: [6, 8] });
  });
});

describe("month-end projection", () => {
  it("projects the rest of the month from what each budget usually spends after today, else at today's rate", async () => {
    for (const name of ["Moradia", "Mercado", "Lazer"]) await createBudget(USER, { entityId: f.pfId, categoryId: c[name], amount: 5000, effectiveFrom: "2026-06" }, prisma);
    for (const m of ["06", "07", "08"]) {
      await spend(f.pfChecking, c.Moradia, 4200, `2026-${m}-05`); // rent: nothing left after the 22nd
      await spend(f.pfChecking, c.Mercado, 600, `2026-${m}-10`);
      await spend(f.pfChecking, c.Mercado, 600, `2026-${m}-25`); // groceries: 600 after the 22nd
    }
    await spend(f.pfChecking, c.Moradia, 4200, "2026-09-05");
    await spend(f.pfChecking, c.Mercado, 600, "2026-09-10");
    await spend(f.pfChecking, c.Lazer, 220, "2026-09-12"); // no history: 10/day for the 8 days left

    const o = await monthOverview(USER, 2026, 9, prisma);
    const projected = Object.fromEntries(o.budgets.map((b) => [b.categoryId, b.pace.projectedTotal]));
    // At 4200 in 22 days, a straight line would say 5727 for the rent.
    expect(projected).toEqual({ [c.Moradia]: 4200, [c.Mercado]: 1200, [c.Lazer]: 300 });
    expect(o.summary.projectedTotal).toBe(5700);

    // A closed month projects what it spent.
    const aug = await monthOverview(USER, 2026, 8, prisma);
    expect(aug.summary.projectedTotal).toBe(5400);
  });
});

describe("year matrix", () => {
  it("has a row per (entity, category) budget, and spend goes to the entity's own budget before the one for every entity", async () => {
    await createBudget(USER, { entityId: f.pfId, categoryId: c.Mercado, amount: 500, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { entityId: f.pjId, categoryId: c.Mercado, amount: 200, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { categoryId: c.Software, amount: 1000, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { entityId: f.pjId, categoryId: c.Software, amount: 300, effectiveFrom: "2026-01" }, prisma);
    await spend(f.pfChecking, c.Mercado, 400, "2026-01-10");
    await spend(f.pfChecking, c.Mercado, 600, "2026-02-10");
    await spend(f.pjChecking, c.Mercado, 250, "2026-01-12");
    await spend(f.pfChecking, c.Software, 100, "2026-01-05");
    await spend(f.pjChecking, c.Software, 200, "2026-01-06");
    await spend(f.pfChecking, c.Lazer, 90, "2026-01-07");

    const y = await yearOverview(USER, 2026, prisma);
    expect(y.categories.map((r) => [r.entityId, r.categoryId])).toEqual([
      [null, c.Software],
      [f.pfId, c.Mercado],
      [f.pjId, c.Mercado],
      [f.pjId, c.Software],
    ]);
    const row = (entityId: string | null, categoryId: string) => y.categories.find((r) => r.entityId === entityId && r.categoryId === categoryId)!;
    expect(row(f.pfId, c.Mercado).months.slice(0, 2).map((m) => [m.spent, m.budget])).toEqual([
      [400, 500],
      [600, 500],
    ]);
    expect(row(f.pfId, c.Mercado).overMonths).toBe(1);
    expect(row(f.pjId, c.Mercado).months[0]).toMatchObject({ spent: 250, budget: 200 });
    expect(row(null, c.Software).months[0]).toMatchObject({ spent: 100, budget: 1000 });
    expect(row(null, c.Software).excludeEntityIds).toEqual([f.pjId]);
    expect(row(f.pjId, c.Software).months[0]).toMatchObject({ spent: 200, budget: 300 });
    expect(y.monthTotals[0]).toBe(950);
    expect(y.monthBudgets[0]).toBe(2000);
    expect(y.summary.overBudgetMonths).toBe(2);

    const withUnbudgeted = await yearOverview(USER, 2026, prisma, { onlyBudgeted: false });
    expect(withUnbudgeted.categories.at(-1)).toMatchObject({ entityId: f.pfId, categoryId: c.Lazer, isBudgeted: false, budgetId: null });
    expect(withUnbudgeted.monthTotals[0]).toBe(1040);

    // The month view splits the spend the same way.
    const jan = await monthOverview(USER, 2026, 1, prisma);
    expect(jan.budgets.map((b) => [b.entityId, b.categoryId, b.spent])).toEqual([
      [null, c.Software, 100],
      [f.pfId, c.Mercado, 400],
      [f.pjId, c.Mercado, 250],
      [f.pjId, c.Software, 200],
    ]);
    expect(jan.unbudgeted).toEqual([expect.objectContaining({ entityId: f.pfId, categoryId: c.Lazer, spent: 90 })]);
  });

  it("lists insights in order (overrun, growth, seasonal) with averages and a suggested amount", async () => {
    const data: [string, string, number, number[]][] = [
      ["Mercado", f.pfId, 2000, [1850, 1920, 2100, 1780, 1990, 2240, 2080, 2310, 1640]],
      ["Software", f.pjId, 2500, [1180, 1220, 1260, 1310, 1350, 1402, 1420, 1488, 1557]],
      ["Lazer", f.pfId, 1000, [420, 1350, 600, 780, 520, 1900, 640, 710, 380]],
      ["Saúde", f.pfId, 1800, [1640, 1700, 2600, 1690, 1720, 1710, 1700, 1650, 1792]],
      ["Moradia", f.pfId, 4500, Array(9).fill(4200)],
    ];
    for (const [name, entityId, amount, months] of data) {
      await createBudget(USER, { entityId, categoryId: c[name], amount, effectiveFrom: "2026-01" }, prisma);
      const account = entityId === f.pfId ? f.pfChecking : f.pjChecking;
      for (const [i, v] of months.entries()) await spend(account, c[name], v, `2026-${String(i + 1).padStart(2, "0")}-10`);
    }
    const y = await yearOverview(USER, 2026, prisma);
    expect(y.insights.map((i) => [i.kind, i.categoryId])).toEqual([
      ["overrun", c.Mercado],
      ["growth", c.Lazer],
      ["growth", c.Software],
      ["seasonal", c["Saúde"]],
    ]);
    const [mercado, lazer, software, saude] = y.insights;
    // The average covers January to August: September is still running (its 1.640 would pull it down).
    expect(mercado).toMatchObject({ overMonths: 4, nElapsed: 9, avg: 2033.75, budget: 2000, suggested: 2050, entityId: f.pfId });
    expect(mercado.budgetId).toBe(y.categories.find((r) => r.categoryId === c.Mercado)!.budgetId);
    expect(lazer).toMatchObject({ first3: 790, last3: 1083.33, growth: 0.3713 });
    expect(software).toMatchObject({ first3: 1220, last3: 1436.67, growth: 0.1776, avg: 1328.75, suggested: 1350 });
    expect(saude).toMatchObject({ peakMonth: 3, peakValue: 2600, budget: 1800 });

    const mercadoRow = y.categories.find((r) => r.categoryId === c.Mercado)!;
    // October to December are projected from the average of June to August.
    expect(mercadoRow.months[9]).toMatchObject({ spent: 2210, isProjected: true });
    expect(y.summary).toMatchObject({ overBudgetMonths: 7, budgetedCells: 45 });
  });
});

describe("Contas fixas", () => {
  it("lists 14 days of non-income bills, overdue reminders and unpaid card statements as faturas", async () => {
    vi.setSystemTime(new Date("2026-10-01T15:00:00Z"));
    await spend(f.card, c.Mercado, 300, "2026-08-20"); // statement 2026-09, due 12/09: overdue
    await spend(f.card, c.Lazer, 120, "2026-09-10"); // statement 2026-10, due 12/10
    await spend(f.card, c.Lazer, 80, "2026-10-01"); // same statement
    const rule = (description: string, accountId: string, amount: number, startDate: string, extra: Record<string, unknown> = {}) =>
      createRecurringRule(USER, { kind: "expense", accountId, amount, description, frequency: "monthly", startDate, autoGenerate: false, ...extra }, prisma);
    await rule("Aluguel", f.pfChecking, 4200, "2026-10-05");
    await rule("Aporte XP", f.pfChecking, 8000, "2026-10-03", { kind: "transfer", toAccountId: f.broker, transferDirection: "investment_deposit", autoGenerate: true });
    await rule("Salário", f.pfChecking, 20000, "2026-10-05", { kind: "income" });
    await rule("DAS Simples", f.pjChecking, 3100, "2026-09-25");
    await rule("Netflix", f.pfChecking, 30, "2026-10-20");
    await rule("Academia", f.pfChecking, 99, "2026-10-15");
    await rule("Encerrada", f.pfChecking, 10, "2026-10-10", { endDate: "2026-10-01" });

    const o = await monthOverview(USER, 2026, 10, prisma);
    expect(o.upcoming.map((u) => [u.dueDate, u.description, u.mode, u.amount, u.overdue])).toEqual([
      ["2026-09-12", "Nubank", "fatura", 300, true],
      ["2026-09-25", "DAS Simples", "reminder", 3100, true],
      ["2026-10-03", "Aporte XP", "auto", 8000, false],
      ["2026-10-05", "Aluguel", "reminder", 4200, false],
      ["2026-10-12", "Nubank", "fatura", 200, false],
      ["2026-10-15", "Academia", "reminder", 99, false],
    ]);
    expect(o.upcoming[0]).toMatchObject({ source: "statement", month: "2026-09", entityId: f.pfId, accountId: f.card, ruleId: null });
    expect(o.upcoming[1]).toMatchObject({ source: "rule", entityId: f.pjId, statementId: null });

    const pj = await monthOverview(USER, 2026, 10, prisma, { entityIds: [f.pjId] });
    expect(pj.upcoming.map((u) => u.description)).toEqual(["DAS Simples"]);

    // Paying the September statement takes it off the list.
    const payment = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 300, date: "2026-09-12", description: "Pagamento fatura" }, prisma);
    await markStatementPayment(USER, payment.entryIds[0], o.upcoming[0].statementId!, prisma);
    expect((await monthOverview(USER, 2026, 10, prisma)).upcoming.filter((u) => u.mode === "fatura").map((u) => u.month)).toEqual(["2026-10"]);
  });
});

describe("drill", () => {
  it("reconciles: a ledger query with a row's filters on effectiveDate sums to the row's spent", async () => {
    await createBudget(USER, { categoryId: c.Software, amount: 1000, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { entityId: f.pjId, categoryId: c.Software, amount: 300, effectiveFrom: "2026-01" }, prisma);
    await createBudget(USER, { entityId: f.pfId, categoryId: c.Mercado, amount: 800, effectiveFrom: "2026-01" }, prisma);
    await spend(f.pfChecking, c.Software, 100, "2026-09-10");
    await spend(f.pjChecking, c.Software, 200, "2026-09-11");
    await spend(f.card, c.Mercado, 150, "2026-08-30"); // statement 2026-09: counts on 05/09
    await spend(f.card, c.Mercado, 60, "2026-09-03"); // same statement
    await spend(f.card, c.Mercado, 999, "2026-09-10"); // statement 2026-10: counts on 05/10
    await spend(f.pfChecking, c.Mercado, 300, "2026-09-15");
    await spend(f.pfChecking, c.Mercado, 45, "2026-09-28"); // after today
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 500, date: "2026-09-12", direction: "capital_injection" }, prisma);
    // A reimbursement's legs are booked as expenses; even with a category they are not budget spend.
    const refund = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 70, date: "2026-09-13", direction: "reimbursement" }, prisma);
    await prisma.ledgerEntry.updateMany({ where: { transferGroupId: refund.transferGroupId! }, data: { categoryId: c.Mercado } });

    const total = async (drill: ReturnType<typeof budgetDrill>) => {
      const result = await queryLedger(USER, { ...drill, includeRows: false }, prisma);
      return -Number(result.totals.values["sum:amountBase"]);
    };
    for (const entityIds of [null, [f.pfId], [f.pjId]]) {
      const o = await monthOverview(USER, 2026, 9, prisma, { entityIds });
      expect(o.budgets.length).toBeGreaterThan(0);
      for (const row of o.budgets) {
        expect(await total(budgetDrill(row, o.scope.entityIds, monthPeriod(2026, 9, o.period.daysElapsed)))).toBeCloseTo(row.spent, 2);
        expect(await total(budgetDrill(row, o.scope.entityIds, monthPeriod(2026, 9)))).toBeCloseTo(row.committed, 2);
      }
    }
    const all = await monthOverview(USER, 2026, 9, prisma);
    const by = Object.fromEntries(all.budgets.map((b) => [`${b.entityId}|${b.categoryId}`, [b.spent, b.committed]]));
    expect(by).toEqual({
      [`null|${c.Software}`]: [100, 100],
      [`${f.pfId}|${c.Mercado}`]: [510, 555],
      [`${f.pjId}|${c.Software}`]: [200, 200],
    });

    // The purchase of 10/09 counts in October, on its statement's closing date.
    const oct = await monthOverview(USER, 2026, 10, prisma);
    const mercado = oct.budgets.find((b) => b.categoryId === c.Mercado)!;
    expect([mercado.spent, mercado.committed]).toEqual([0, 999]);
    expect(await total(budgetDrill(mercado, null, monthPeriod(2026, 10)))).toBeCloseTo(999, 2);

    // The year matrix's cells reconcile the same way.
    const y = await yearOverview(USER, 2026, prisma);
    for (const row of y.categories) {
      expect(await total(budgetDrill(row, null, monthPeriod(2026, 9, 22)))).toBeCloseTo(row.months[8].spent, 2);
    }
  });
});
