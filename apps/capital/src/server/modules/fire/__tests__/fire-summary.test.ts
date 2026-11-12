import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getUserToday } from "@capital/server/lib/date-utils";
import { prisma } from "@capital/server/lib/prisma";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { getFireSummary } from "../services/get-fire-summary";
import { upsertFireGoal } from "../services/upsert-fire-goal";
import { TRAILING_MONTHS } from "../constants";
import type { FireGoalPatch } from "../validations/fire";

const USER = "test-user-fire-summary-001";

let f: LedgerFixture;

const BASE = {
  targetMonthlyIncome: 10000,
  safeWithdrawalRate: 0.04,
  nominalAnnualReturn: 0.1,
  annualInflation: 0.04,
  planningMode: "by_contribution",
  phaseProfile: "custom",
  phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 3000 }],
} satisfies FireGoalPatch;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Moradia", type: "expense" },
      { name: "Mercado", type: "expense" },
      { name: "Lazer", type: "expense" },
      { name: "Investment", type: "expense" },
      { name: "Salário", type: "income" },
    ],
  });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const entry = (kind: "expense" | "income", amount: number, date: Date, categoryId: string | null, accountId = f.pfChecking) =>
  prisma.ledgerEntry.create({
    data: { userId: USER, entityId: f.pfId, accountId, kind, amount, currency: "BRL", exchangeRate: 1, amountBase: amount, date, effectiveDate: date, description: "x", categoryId },
  });

async function holding(accountId: string, value: number, ticker: string) {
  const created = await createHolding(USER, { accountId, assetClass: "stocks", ticker, name: ticker, currency: "BRL" }, prisma);
  await prisma.investmentHolding.update({ where: { id: created.id }, data: { currentQuantity: 1, currentPrice: value, totalInvested: value } });
}

const summary = (opts: Parameters<typeof getFireSummary>[2] = { skipSnapshot: true }) => getFireSummary(USER, prisma, opts);
const goalSnapshots = async () => prisma.fireSnapshot.findMany({ where: { goal: { userId: USER } }, orderBy: { period: "asc" } });

describe("without a plan", () => {
  it("still summarises real income and spending, leaving out investment outflows and keeping the biggest eight categories", async () => {
    const categories = await Promise.all(["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((name) => prisma.category.create({ data: { userId: USER, name: `Cat ${name}`, type: "expense" } })));
    for (const [index, category] of categories.entries()) await entry("expense", -(100 + index * 10), daysAgo(20), category.id);
    await entry("expense", -45, daysAgo(25), null);
    await entry("expense", -45, daysAgo(26), null);
    await entry("expense", -9_999, daysAgo(20), f.categories.Investment!);
    await entry("income", 6000, daysAgo(15), f.categories["Salário"]!);
    await entry("income", 600, daysAgo(400), f.categories["Salário"]!);

    const result = await summary();

    expect(result).toMatchObject({ hasGoal: false, goal: null, result: null, requiredContribution: null, projection: null, scenarios: [], tiers: [], coast: null, history: [], currentMonthContribution: null, altProjection: null });
    expect(result.breakdown.monthlyIncome).toBeCloseTo(6000 / TRAILING_MONTHS, 6);
    // 9 categories + uncategorised = 10 groups; the cheapest two are cut. "Investment" is not consumption.
    expect(result.breakdown.expensesByCategory).toHaveLength(8);
    expect(result.breakdown.expensesByCategory.map((row) => row.category)).toEqual(["Cat I", "Cat H", "Cat G", "Cat F", "Cat E", "Cat D", "Cat C", "Cat B"]);
    expect(result.breakdown.expensesByCategory[0]?.amount).toBeCloseTo(180 / TRAILING_MONTHS, 6);
    expect(result.breakdown.expensesByCategory.every((row) => row.category !== "Investment")).toBe(true);
    expect(result.breakdown.passiveIncomeNow).toBe(0);
  });

  it("groups spending without a category under 'Uncategorized' and uses the default withdrawal rate for passive income", async () => {
    await holding(f.broker, 120_000, "PETR4");
    await entry("expense", -300, daysAgo(20), null);
    await entry("expense", -300, daysAgo(21), null);

    const result = await summary();

    expect(result.breakdown.expensesByCategory).toEqual([{ category: "Uncategorized", amount: 600 / TRAILING_MONTHS }]);
    expect(result.suggestedDefaults.currentInvested).toBe(120_000);
    // 120000 * 3.5% / 12, since there is no plan to take a rate from.
    expect(result.breakdown.passiveIncomeNow).toBeCloseTo(350, 6);
    expect(result.suggestedDefaults.currentMonthlyExpenses).toBeCloseTo(600 / TRAILING_MONTHS, 6);
  });
});

describe("with a plan", () => {
  it("counts business investments only when the plan opts in", async () => {
    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Inter PJ", currency: "BRL" } });
    await holding(f.broker, 10_000, "PETR4");
    await holding(pjBroker.id, 5_000, "VALE3");
    await upsertFireGoal(USER, { ...BASE }, prisma);
    expect((await summary()).result?.currentInvested).toBe(10_000);
    await upsertFireGoal(USER, { includeBusinessInvestments: true }, prisma);
    expect((await summary()).result?.currentInvested).toBe(15_000);
  });

  it("sizes the by-date contribution from a preset profile rather than the stored phases", async () => {
    await upsertFireGoal(USER, { ...BASE, planningMode: "by_date", targetYear: new Date().getFullYear() + 15, phaseProfile: "constant" }, prisma);

    const result = await summary();

    expect(result.requiredContribution?.baseContribution).toBeGreaterThan(0);
    const phases = result.requiredContribution!.phases;
    expect(phases.length).toBeGreaterThan(0);
    // A constant profile pays the same amount in every phase.
    expect(new Set(phases.map((phase) => phase.monthlyContribution)).size).toBe(1);
    expect(result.currentMonthContribution).toBeCloseTo(phases[0]!.monthlyContribution, 6);
    expect(result.result?.reached).toBe(false);
  });

  it("reports no solution, not an infinite contribution, when no phase contributes anything to scale", async () => {
    await upsertFireGoal(
      USER,
      { ...BASE, planningMode: "by_date", targetYear: new Date().getFullYear() + 10, phaseProfile: "custom", phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 0 }] },
      prisma,
    );

    const result = await summary();

    expect(result.requiredContribution?.baseContribution).toBeNull();
    expect(result.requiredContribution?.phases.length).toBeGreaterThan(0);
    expect(result.requiredContribution!.phases.every((phase) => phase.monthlyContribution === 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.requiredContribution))).toEqual(result.requiredContribution);
    expect(result.currentMonthContribution).toBe(0);
  });

  it("prescribes nothing when growth alone gets the portfolio to the number by the target year", async () => {
    await holding(f.broker, 3_000_000, "PETR4");
    await upsertFireGoal(USER, { ...BASE, planningMode: "by_date", targetYear: new Date().getFullYear() + 5, phaseProfile: "constant" }, prisma);
    const result = await summary();
    expect(result.requiredContribution?.baseContribution).toBe(0);
    expect(result.currentMonthContribution).toBe(0);
  });

  it("shows no progress, instead of dividing by zero, when a stored plan's number is zero", async () => {
    await holding(f.broker, 5_000, "PETR4");
    await upsertFireGoal(USER, { ...BASE }, prisma);
    await prisma.fireGoal.update({ where: { userId: USER }, data: { targetMonthlyIncome: 0 } });

    const result = await summary({});

    expect(result.result).toMatchObject({ fireNumber: 0, progress: 0, reached: true });
    expect((await goalSnapshots())[0]).toMatchObject({ fireNumber: 0, progress: 0 });
  });

  it("keeps the stored phases when planning by date with a target year already in the past", async () => {
    await upsertFireGoal(USER, { ...BASE, planningMode: "by_date", targetYear: 2001 }, prisma);
    const result = await summary();
    expect(result.requiredContribution).toBeNull();
    expect(result.currentMonthContribution).toBe(3000);
  });

  it("reports a plan that never reaches its number as unreachable, without a date", async () => {
    await upsertFireGoal(USER, { ...BASE, phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 0 }], nominalAnnualReturn: 0.04, annualInflation: 0.04 }, prisma);

    const result = await summary({});

    expect(result.result).toMatchObject({ monthsToFire: null, yearsToFire: null, projectedFireDate: null, reached: false });
    expect(result.scenarios.every((scenario) => scenario.monthsToFire === null || Number.isFinite(scenario.monthsToFire))).toBe(true);
    const [stored] = await goalSnapshots();
    expect(stored).toMatchObject({ monthsToFire: null, projectedFireDate: null });
    expect(stored?.fireNumber).toBe(3_000_000);
  });

  it("marks the number as reached once the portfolio covers it", async () => {
    await holding(f.broker, 3_500_000, "PETR4");
    await upsertFireGoal(USER, { ...BASE }, prisma);
    const result = await summary();
    expect(result.result).toMatchObject({ reached: true, monthsToFire: 0 });
    expect(result.result!.progress).toBeCloseTo(3_500_000 / 3_000_000, 10);
  });

  it("projects when the number is reached with a coast stop year, and has a coast block only with one", async () => {
    await upsertFireGoal(USER, { ...BASE }, prisma);
    expect((await summary()).coast).toBeNull();
    await upsertFireGoal(USER, { coastStopYear: new Date().getFullYear() + 10 }, prisma);
    const coast = (await summary()).coast;
    expect(coast).not.toBeNull();
    await upsertFireGoal(USER, { coastStopYear: 2001 }, prisma);
    expect((await summary()).coast).toBeNull();
  });

  it("takes the retirement age from the current age and the month the plan retires", async () => {
    await upsertFireGoal(USER, { ...BASE }, prisma);
    expect((await summary()).result).toMatchObject({ retirementAge: 0 });
    await upsertFireGoal(USER, { currentAge: 40 }, prisma);
    const aged = (await summary()).result!;
    expect(aged.retirementAge).toBeCloseTo(40 + aged.retirementMonthIndex / 12, 10);
    expect(aged.retirementMonthIndex).toBeGreaterThan(0);
  });

  it("adds the date for another monthly amount, including none at all", async () => {
    await upsertFireGoal(USER, { ...BASE }, prisma);
    const none = (await summary({ skipSnapshot: true, altContribution: 0 })).altProjection;
    expect(none).toMatchObject({ monthlyContribution: 0, monthsToFire: null, projectedFireDate: null });
    const some = (await summary({ skipSnapshot: true, altContribution: 50_000 })).altProjection;
    expect(some?.monthlyContribution).toBe(50_000);
    expect(some?.monthsToFire).toBeGreaterThan(0);
    expect(some?.projectedFireDate).toEqual(expect.any(String));
  });
});

describe("spend-down (depletion) plans", () => {
  const DEPLETION = { ...BASE, withdrawalStrategy: "depletion", currentAge: 40, lifeExpectancyAge: 90, annualVolatility: 0 } satisfies FireGoalPatch;

  it("sizes the headline number and the retirement month from the depletion solve when planning by contribution", async () => {
    await holding(f.broker, 200_000, "PETR4");
    await upsertFireGoal(USER, { ...DEPLETION }, prisma);

    const result = await summary({});

    expect(result.requiredContribution).toBeNull();
    const headline = result.result!;
    expect(headline.fireNumber).toBeGreaterThan(0);
    // Spending down needs less than a perpetuity: the number is below income * 12 / rate.
    expect(headline.fireNumber).toBeLessThan(3_000_000);
    expect(headline.retirementMonthIndex).toBeGreaterThanOrEqual(0);
    expect(headline.retirementAge).toBeCloseTo(40 + headline.retirementMonthIndex / 12, 10);
    const [stored] = await goalSnapshots();
    expect(stored?.fireNumber).toBeCloseTo(headline.fireNumber, 6);
    expect(stored?.progress).toBeCloseTo(headline.progress, 10);
  });

  it("prescribes the contribution from the same solve when planning by date", async () => {
    await holding(f.broker, 200_000, "PETR4");
    await upsertFireGoal(USER, { ...DEPLETION, planningMode: "by_date", targetYear: new Date().getFullYear() + 12, phaseProfile: "constant" }, prisma);

    const result = await summary();

    expect(result.requiredContribution).not.toBeNull();
    expect(result.requiredContribution!.phases.length).toBeGreaterThan(0);
    const base = result.requiredContribution!.baseContribution;
    expect(base === null || (Number.isFinite(base) && base >= 0)).toBe(true);
    expect(result.currentMonthContribution).toBe(result.requiredContribution!.phases[0]!.monthlyContribution);
  });

  it("reports no solution when planning by date and no phase contributes anything to scale", async () => {
    await upsertFireGoal(
      USER,
      { ...DEPLETION, planningMode: "by_date", targetYear: new Date().getFullYear() + 12, phaseProfile: "custom", phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 0 }] },
      prisma,
    );

    const result = await summary();

    expect(result.requiredContribution?.baseContribution).toBeNull();
    expect(result.requiredContribution!.phases.every((phase) => phase.monthlyContribution === 0)).toBe(true);
    // Not reachable: no month to reach it in, rather than an infinite one.
    expect(result.result?.monthsToFire).toBeNull();
    expect(result.result?.projectedFireDate).toBeNull();
  });

  it("solves with the Monte Carlo when the plan has volatility", async () => {
    await upsertFireGoal(USER, { ...DEPLETION, annualVolatility: 0.12 }, prisma);
    const result = await summary();
    expect(result.result!.fireNumber).toBeGreaterThan(0);
    expect(Number.isFinite(result.result!.retirementMonthIndex)).toBe(true);
  }, 60_000);

  it("falls back to the perpetuity number when the plan has no current age to size a horizon from", async () => {
    await upsertFireGoal(USER, { ...DEPLETION, currentAge: undefined }, prisma);
    await prisma.fireGoal.update({ where: { userId: USER }, data: { currentAge: null } });
    const result = await summary();
    expect(result.result?.fireNumber).toBe(3_000_000);
    expect(result.result?.retirementAge).toBe(0);
    expect(result.result?.retirementMonthIndex).toBe(0);
  });
});

describe("the monthly snapshot", () => {
  /** The month the app is in for a user on the default timezone (the one the fixture users have). */
  const thisPeriod = () => {
    const now = getUserToday("America/Sao_Paulo");
    return now.getFullYear() * 100 + now.getMonth() + 1;
  };

  it("is written the first time, kept by later reads, refreshed when forced and skipped on request", async () => {
    await upsertFireGoal(USER, { ...BASE }, prisma);
    await summary({ skipSnapshot: true });
    expect(await goalSnapshots()).toEqual([]);

    await holding(f.broker, 40_000, "PETR4");
    await summary({});
    await holding(f.broker, 10_000, "VALE3");
    await summary({});
    expect((await goalSnapshots()).map((row) => [row.period, row.currentInvested])).toEqual([[thisPeriod(), 40_000]]);

    const forced = await summary({ forceSnapshot: true });
    expect(forced.history).toHaveLength(1);
    expect(forced.history[0]).toMatchObject({ period: thisPeriod(), currentInvested: 50_000 });
    expect((await goalSnapshots())[0]?.currentInvested).toBe(50_000);
  });
});
