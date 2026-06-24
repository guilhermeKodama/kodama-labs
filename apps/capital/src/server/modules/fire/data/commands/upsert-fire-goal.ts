import type { DbClient } from "@capital/server/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import type { FireGoalInput } from "../../validations/fire";

/** Create or replace the user's single FIRE plan (one per user). */
export async function upsertFireGoal(userId: string, data: FireGoalInput, db: DbClient) {
  const payload = {
    name: data.name ?? null,
    targetMonthlyIncome: data.targetMonthlyIncome,
    safeWithdrawalRate: data.safeWithdrawalRate,
    nominalAnnualReturn: data.nominalAnnualReturn,
    annualInflation: data.annualInflation,
    monthlyIncome: data.monthlyIncome ?? null,
    planningMode: data.planningMode,
    targetYear: data.targetYear ?? null,
    phaseProfile: data.phaseProfile,
    phases: data.phases as unknown as Prisma.InputJsonValue,
    baristaMonthlyIncome: data.baristaMonthlyIncome ?? null,
    coastStopYear: data.coastStopYear ?? null,
    leanMultiplier: data.leanMultiplier,
    fatMultiplier: data.fatMultiplier,
    includeEntityBalances: data.includeEntityBalances,
    includeBusinessInvestments: data.includeBusinessInvestments,
    currency: data.currency,
    currentAge: data.currentAge ?? null,
    retirementAge: data.retirementAge ?? null,
    lifeExpectancyAge: data.lifeExpectancyAge,
    annualVolatility: data.annualVolatility,
    milestones: data.milestones as unknown as Prisma.InputJsonValue,
    withdrawalStrategy: data.withdrawalStrategy,
  };

  return db.fireGoal.upsert({
    where: { userId },
    create: { userId, ...payload },
    update: payload,
  });
}
