import type { FireGoal, FireSnapshot } from "@/generated/prisma";
import type {
  FireGoalResponse,
  FirePhaseInput,
  FireSnapshotResponse,
  MilestoneInput,
} from "../validations/fire";

/** Infinity (never reached) -> null for JSON. */
export const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

export const serializeDate = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function serializeGoal(goal: FireGoal): FireGoalResponse {
  return {
    id: goal.id,
    name: goal.name,
    targetMonthlyIncome: goal.targetMonthlyIncome,
    safeWithdrawalRate: goal.safeWithdrawalRate,
    nominalAnnualReturn: goal.nominalAnnualReturn,
    annualInflation: goal.annualInflation,
    monthlyIncome: goal.monthlyIncome,
    planningMode: goal.planningMode,
    targetYear: goal.targetYear,
    phaseProfile: goal.phaseProfile,
    phases: (goal.phases as unknown as FirePhaseInput[]) ?? [],
    baristaMonthlyIncome: goal.baristaMonthlyIncome,
    coastStopYear: goal.coastStopYear,
    leanMultiplier: goal.leanMultiplier,
    fatMultiplier: goal.fatMultiplier,
    includeEntityBalances: goal.includeEntityBalances,
    includeBusinessInvestments: goal.includeBusinessInvestments,
    currency: goal.currency,
    currentAge: goal.currentAge,
    retirementAge: goal.retirementAge,
    lifeExpectancyAge: goal.lifeExpectancyAge,
    annualVolatility: goal.annualVolatility,
    milestones: (goal.milestones as unknown as MilestoneInput[]) ?? [],
    withdrawalStrategy: goal.withdrawalStrategy,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export function serializeSnapshot(s: FireSnapshot): FireSnapshotResponse {
  return {
    period: s.period,
    snapshotDate: s.snapshotDate.toISOString(),
    currentInvested: s.currentInvested,
    currentMonthlyExpenses: s.currentMonthlyExpenses,
    fireNumber: s.fireNumber,
    progress: s.progress,
    monthsToFire: s.monthsToFire,
    projectedFireDate: s.projectedFireDate ? s.projectedFireDate.toISOString() : null,
  };
}
