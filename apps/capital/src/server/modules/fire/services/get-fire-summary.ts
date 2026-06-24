import type { DbClient } from "@capital/server/lib/prisma";
import { getUserToday } from "@capital/server/lib/date-utils";
import type { ContributionPhase, PhaseProfile, WithdrawalStrategy } from "@/lib/fire";
import {
  buildProjection,
  computeCoastFire,
  computeFireNumber,
  computeFireResult,
  computeScenarios,
  computeTiers,
  buildPhaseShape,
  depletionFireNumber,
  monthsToFirePhased,
  phasesToShape,
  resolvePhases,
  solveBaseContributionForDate,
  projectFireDate,
  monthsUntilYear,
  toMonthlyRate,
  toRealReturn,
} from "@/lib/fire";
import {
  buildAssumptions,
  computeCurrentInvested,
  computeCurrentMonthlyExpenses,
  computeExpenseGap,
  computeSuggestedMonthlyContribution,
  INVESTMENT_CATEGORY,
} from "@/lib/fire/adapter";

import { TRAILING_MONTHS } from "../constants";
import type { FirePhaseInput, FireSummaryResponse } from "../validations/fire";
import { fetchFireGoal } from "../data/queries/fetch-fire-goal";
import { fetchFireInputs } from "../data/queries/fetch-fire-inputs";
import { fetchFireSnapshots } from "../data/queries/fetch-fire-snapshots";
import { recordFireSnapshot } from "../data/commands/record-fire-snapshot";
import { finite, serializeDate, serializeGoal, serializeSnapshot } from "./serialize";

/**
 * The whole FIRE dashboard payload: current state, the income-vs-expenses gap,
 * the prescribed plan (required contribution when planning by date), projection,
 * scenarios, comparison tiers, coast status and historical snapshots.
 *
 * Also lazily records this month's snapshot (or refreshes it when `forceSnapshot`).
 */
export async function getFireSummary(
  userId: string,
  db: DbClient,
  opts: { forceSnapshot?: boolean } = {}
): Promise<FireSummaryResponse> {
  const inputs = await fetchFireInputs(userId, db, { trailingMonths: TRAILING_MONTHS });
  const now = getUserToday(inputs.timezone);
  const goal = await fetchFireGoal(userId, db);

  // The FIRE base is personal investments by default; business investments are
  // opt-in via the plan toggle.
  const includeBusiness = goal?.includeBusinessInvestments ?? false;
  const holdings = inputs.holdings.filter((h) => includeBusiness || h.entityType === "personal");
  const accounts = inputs.accounts.filter((a) => includeBusiness || a.entityType === "personal");
  const currentInvested = computeCurrentInvested(holdings, accounts, inputs.currencyRates);

  const currentMonthlyExpenses = computeCurrentMonthlyExpenses(inputs.expenses, {
    months: TRAILING_MONTHS,
    now,
  });
  const suggestedMonthlyContribution = computeSuggestedMonthlyContribution(inputs.contributions, {
    months: TRAILING_MONTHS,
    now,
  });
  const suggestedDefaults = { currentInvested, currentMonthlyExpenses, suggestedMonthlyContribution };

  // Current breakdown (income / expenses-by-category / passive income) — derived
  // from real data, independent of whether a plan exists.
  const breakdownSwr = goal?.safeWithdrawalRate ?? 0.035;
  const categoryTotals = new Map<string, number>();
  for (const e of inputs.expenses) {
    if (e.category === INVESTMENT_CATEGORY) continue;
    const key = e.category ?? "Uncategorized";
    categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + e.amount * e.exchangeRate);
  }
  const breakdown = {
    monthlyIncome: inputs.income.reduce((s, t) => s + t.amount * t.exchangeRate, 0) / TRAILING_MONTHS,
    monthlyExpenses: currentMonthlyExpenses,
    passiveIncomeNow: (currentInvested * breakdownSwr) / 12,
    expensesByCategory: Array.from(categoryTotals.entries())
      .map(([category, total]) => ({ category, amount: total / TRAILING_MONTHS }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8),
  };

  if (!goal) {
    return {
      hasGoal: false,
      baseCurrency: inputs.baseCurrency,
      goal: null,
      suggestedDefaults,
      breakdown,
      result: null,
      gap: null,
      requiredContribution: null,
      projection: null,
      scenarios: [],
      tiers: [],
      coast: null,
      history: [],
    };
  }

  const goalPhases = (goal.phases as unknown as FirePhaseInput[]) ?? [];
  const realAnnualReturn = toRealReturn(goal.nominalAnnualReturn, goal.annualInflation);
  const monthlyRealReturn = toMonthlyRate(realAnnualReturn);
  const perpetuityFireNumber = computeFireNumber(goal.targetMonthlyIncome * 12, goal.safeWithdrawalRate);
  const strategy = goal.withdrawalStrategy as WithdrawalStrategy;
  // Drawdown horizon (months to life expectancy) — needed to size a depletion target.
  const horizonMonthIndex =
    goal.currentAge != null ? Math.ceil((goal.lifeExpectancyAge - goal.currentAge) * 12) : null;
  const canUseDepletion = strategy === "depletion" && horizonMonthIndex != null;

  // Planning direction. "by_date" prescribes the contribution needed to hit the
  // target year; otherwise the user's own phase contributions drive the date.
  let effectivePhases: ContributionPhase[] = goalPhases;
  let requiredContribution: FireSummaryResponse["requiredContribution"] = null;

  if (goal.planningMode === "by_date" && goal.targetYear) {
    const targetMonths = monthsUntilYear(goal.targetYear, now);
    if (targetMonths > 0) {
      const shape =
        goal.phaseProfile === "custom"
          ? phasesToShape(goalPhases)
          : buildPhaseShape(goal.phaseProfile as PhaseProfile);
      // Hit the strategy's target by the chosen date: living off the yield needs the
      // full perpetuity number; spending down needs only the annuity that lasts to
      // the horizon (so the prescribed contribution is much smaller).
      const solveTarget =
        canUseDepletion && horizonMonthIndex != null
          ? depletionFireNumber(
              {
                targetMonthlyIncome: goal.targetMonthlyIncome,
                realAnnualReturn,
                safeWithdrawalRate: goal.safeWithdrawalRate,
              },
              goal.annualVolatility,
              Math.max(0, horizonMonthIndex - targetMonths)
            )
          : perpetuityFireNumber;
      const baseContribution = solveBaseContributionForDate({
        currentInvested,
        monthlyRealReturn,
        fireNumber: solveTarget,
        targetMonths,
        shape,
      });
      const solvable = Number.isFinite(baseContribution);
      const resolved = resolvePhases(shape, solvable ? baseContribution : 0);
      effectivePhases = resolved;
      requiredContribution = {
        baseContribution: solvable ? baseContribution : null,
        phases: resolved,
      };
    }
  }

  const assumptions = buildAssumptions(
    {
      targetMonthlyIncome: goal.targetMonthlyIncome,
      safeWithdrawalRate: goal.safeWithdrawalRate,
      nominalAnnualReturn: goal.nominalAnnualReturn,
      annualInflation: goal.annualInflation,
      monthlyIncome: goal.monthlyIncome,
      phases: effectivePhases,
      withdrawalStrategy: strategy,
    },
    currentInvested
  );

  const result = computeFireResult(assumptions, {
    currentAge: goal.currentAge,
    lifeExpectancyAge: goal.lifeExpectancyAge,
    retirementAge: goal.retirementAge,
    annualVolatility: goal.annualVolatility,
  });

  // Strategy-aware headline number + time-to-FIRE. For by_date depletion the
  // retirement is pinned to the chosen year, so size the annuity to that date
  // rather than the natural crossing computeFireResult uses.
  let fireNumber = result.fireNumber;
  let monthsToFire = result.monthsToFire;
  if (
    canUseDepletion &&
    horizonMonthIndex != null &&
    goal.planningMode === "by_date" &&
    goal.targetYear
  ) {
    const targetMonths = monthsUntilYear(goal.targetYear, now);
    if (targetMonths > 0) {
      fireNumber = depletionFireNumber(
        {
          targetMonthlyIncome: goal.targetMonthlyIncome,
          realAnnualReturn,
          safeWithdrawalRate: goal.safeWithdrawalRate,
        },
        goal.annualVolatility,
        Math.max(0, horizonMonthIndex - targetMonths)
      );
      monthsToFire = monthsToFirePhased(currentInvested, effectivePhases, monthlyRealReturn, fireNumber);
    }
  }
  const progress = fireNumber > 0 ? currentInvested / fireNumber : 0;
  const reached = currentInvested >= fireNumber;
  const sampling = Number.isFinite(monthsToFire) && monthsToFire <= 360 ? 1 : 12;
  const projection = buildProjection(assumptions, { samplingEveryMonths: sampling });
  const scenarios = computeScenarios(assumptions);
  const tiers = computeTiers(assumptions, {
    lean: goal.leanMultiplier,
    fat: goal.fatMultiplier,
    baristaMonthlyIncome: goal.baristaMonthlyIncome ?? undefined,
  });
  const gap = computeExpenseGap(goal.targetMonthlyIncome, currentMonthlyExpenses);
  const projectedFireDate = projectFireDate(now, monthsToFire);

  const coastYear = goal.coastStopYear ?? goal.targetYear;
  const coast =
    coastYear && monthsUntilYear(coastYear, now) > 0
      ? computeCoastFire(assumptions, monthsUntilYear(coastYear, now))
      : null;

  // Lazy (or forced) monthly snapshot.
  const period = now.getFullYear() * 100 + (now.getMonth() + 1);
  await recordFireSnapshot(
    goal.id,
    period,
    {
      snapshotDate: now,
      currentInvested,
      currentMonthlyExpenses,
      fireNumber,
      progress,
      monthsToFire: Number.isFinite(monthsToFire) ? Math.round(monthsToFire) : null,
      projectedFireDate,
    },
    opts.forceSnapshot ?? false,
    db
  );

  const snapshots = await fetchFireSnapshots(goal.id, db);

  return {
    hasGoal: true,
    baseCurrency: inputs.baseCurrency,
    goal: serializeGoal(goal),
    suggestedDefaults,
    breakdown,
    result: {
      fireNumber,
      currentInvested,
      progress,
      reached,
      monthsToFire: finite(monthsToFire),
      yearsToFire: finite(monthsToFire / 12),
      projectedFireDate: serializeDate(projectedFireDate),
      currentMonthlyPassiveIncome: result.currentMonthlyPassiveIncome,
      realAnnualReturn,
      savingsRate: result.savingsRate,
    },
    gap,
    requiredContribution,
    projection: {
      points: projection.points,
      fireNumber: projection.fireNumber,
      monthsToFire: finite(projection.monthsToFire),
    },
    scenarios: scenarios.map((s) => ({
      key: s.key,
      realAnnualReturn: s.realAnnualReturn,
      monthsToFire: finite(s.monthsToFire),
      yearsToFire: finite(s.yearsToFire),
      projectedFireDate: serializeDate(projectFireDate(now, s.monthsToFire)),
    })),
    tiers: tiers.map((t) => ({
      tier: t.tier,
      expenseMultiplier: t.expenseMultiplier,
      fireNumber: t.fireNumber,
      progress: t.progress,
      monthsToFire: finite(t.monthsToFire),
    })),
    coast,
    history: snapshots.map(serializeSnapshot),
  };
}
