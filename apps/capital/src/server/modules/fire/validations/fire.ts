import { z } from "@hono/zod-openapi";

export const PLANNING_MODES = ["by_date", "by_contribution"] as const;
export const PHASE_PROFILES = ["front_loaded", "constant", "back_loaded", "custom"] as const;
export const WITHDRAWAL_STRATEGIES = ["perpetuity", "depletion"] as const;

export const PhaseSchema = z.object({
  fromMonth: z.number().int().min(0),
  toMonth: z.number().int().min(0).nullable(),
  monthlyContribution: z.number().min(0),
  label: z.string().optional(),
});

export const MILESTONE_TYPES = [
  "net_worth_absolute",
  "net_worth_x_expenses",
  "passive_income_absolute",
  "age",
  "coast",
] as const;

export const MilestoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(MILESTONE_TYPES),
  value: z.number(),
});

/** PUT /v1/fire/goal body — the editable plan. */
export const FireGoalInputSchema = z.object({
  name: z.string().nullish(),
  targetMonthlyIncome: z.number().positive(),
  safeWithdrawalRate: z.number().positive().max(1),
  nominalAnnualReturn: z.number(),
  annualInflation: z.number(),
  monthlyIncome: z.number().nonnegative().nullish(),
  planningMode: z.enum(PLANNING_MODES),
  targetYear: z.number().int().min(2000).max(2200).nullish(),
  phaseProfile: z.enum(PHASE_PROFILES),
  phases: z.array(PhaseSchema).min(1),
  baristaMonthlyIncome: z.number().nonnegative().nullish(),
  coastStopYear: z.number().int().min(2000).max(2200).nullish(),
  leanMultiplier: z.number().positive().default(0.7),
  fatMultiplier: z.number().positive().default(1.6),
  includeEntityBalances: z.boolean().default(false),
  includeBusinessInvestments: z.boolean().default(false),
  currency: z.string().min(1).default("BRL"),
  currentAge: z.number().int().min(0).max(120).nullish(),
  retirementAge: z.number().int().min(0).max(120).nullish(),
  lifeExpectancyAge: z.number().int().min(1).max(130).default(95),
  annualVolatility: z.number().min(0).max(1).default(0.12),
  milestones: z.array(MilestoneSchema).default([]),
  withdrawalStrategy: z.enum(WITHDRAWAL_STRATEGIES).default("perpetuity"),
});

export const FireGoalSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  targetMonthlyIncome: z.number(),
  safeWithdrawalRate: z.number(),
  nominalAnnualReturn: z.number(),
  annualInflation: z.number(),
  monthlyIncome: z.number().nullable(),
  planningMode: z.string(),
  targetYear: z.number().nullable(),
  phaseProfile: z.string(),
  phases: z.array(PhaseSchema),
  baristaMonthlyIncome: z.number().nullable(),
  coastStopYear: z.number().nullable(),
  leanMultiplier: z.number(),
  fatMultiplier: z.number(),
  includeEntityBalances: z.boolean(),
  includeBusinessInvestments: z.boolean(),
  currency: z.string(),
  currentAge: z.number().nullable(),
  retirementAge: z.number().nullable(),
  lifeExpectancyAge: z.number(),
  annualVolatility: z.number(),
  milestones: z.array(MilestoneSchema),
  withdrawalStrategy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const FireResultSchema = z.object({
  fireNumber: z.number(),
  currentInvested: z.number(),
  progress: z.number(),
  reached: z.boolean(),
  monthsToFire: z.number().nullable(), // null = never reachable at current pace
  yearsToFire: z.number().nullable(),
  projectedFireDate: z.string().nullable(),
  currentMonthlyPassiveIncome: z.number(),
  realAnnualReturn: z.number(),
  savingsRate: z.number().nullable(),
  // Canonical retirement timing — the single source of truth the client pins into
  // the lifecycle + Monte Carlo, so the chart, marker, gauge and hero all agree.
  retirementMonthIndex: z.number(),
  retirementAge: z.number(),
});

export const FireGapSchema = z.object({
  targetMonthlyIncome: z.number(),
  currentMonthlyExpenses: z.number(),
  difference: z.number(),
  percentDifference: z.number().nullable(),
  direction: z.enum(["above", "below", "equal"]),
});

export const FireProjectionPointSchema = z.object({
  monthIndex: z.number(),
  yearOffset: z.number(),
  investedValue: z.number(),
  contributionsToDate: z.number(),
  growthToDate: z.number(),
  reachedFire: z.boolean(),
});

export const FireScenarioSchema = z.object({
  key: z.enum(["pessimistic", "realistic", "optimistic"]),
  realAnnualReturn: z.number(),
  monthsToFire: z.number().nullable(),
  yearsToFire: z.number().nullable(),
  projectedFireDate: z.string().nullable(),
});

export const FireTierSchema = z.object({
  tier: z.enum(["lean", "regular", "fat", "barista"]),
  expenseMultiplier: z.number(),
  fireNumber: z.number(),
  progress: z.number(),
  monthsToFire: z.number().nullable(),
});

export const CoastSchema = z.object({
  coastNumber: z.number(),
  reached: z.boolean(),
  progress: z.number(),
  targetMonths: z.number(),
});

export const RequiredContributionSchema = z.object({
  baseContribution: z.number().nullable(), // null = unreachable by contributions alone
  phases: z.array(PhaseSchema),
});

export const SuggestedDefaultsSchema = z.object({
  currentInvested: z.number(),
  currentMonthlyExpenses: z.number(),
  suggestedMonthlyContribution: z.number(),
});

export const FireSnapshotSchema = z.object({
  period: z.number(),
  snapshotDate: z.string(),
  currentInvested: z.number(),
  currentMonthlyExpenses: z.number(),
  fireNumber: z.number(),
  progress: z.number(),
  monthsToFire: z.number().nullable(),
  projectedFireDate: z.string().nullable(),
});

export const FireBreakdownSchema = z.object({
  monthlyIncome: z.number(),
  monthlyExpenses: z.number(),
  passiveIncomeNow: z.number(),
  expensesByCategory: z.array(z.object({ category: z.string(), amount: z.number() })),
});

export const FireSummaryResponseSchema = z.object({
  hasGoal: z.boolean(),
  baseCurrency: z.string(),
  goal: FireGoalSchema.nullable(),
  suggestedDefaults: SuggestedDefaultsSchema,
  breakdown: FireBreakdownSchema,
  result: FireResultSchema.nullable(),
  gap: FireGapSchema.nullable(),
  requiredContribution: RequiredContributionSchema.nullable(),
  projection: z
    .object({
      points: z.array(FireProjectionPointSchema),
      fireNumber: z.number(),
      monthsToFire: z.number().nullable(),
    })
    .nullable(),
  scenarios: z.array(FireScenarioSchema),
  tiers: z.array(FireTierSchema),
  coast: CoastSchema.nullable(),
  history: z.array(FireSnapshotSchema),
});

export const SnapshotUpsertSchema = z.object({
  currentInvested: z.number().nonnegative(),
  currentMonthlyExpenses: z.number().nonnegative().optional(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type FireGoalInput = z.infer<typeof FireGoalInputSchema>;
export type FirePhaseInput = z.infer<typeof PhaseSchema>;
export type MilestoneInput = z.infer<typeof MilestoneSchema>;
export type FireGoalResponse = z.infer<typeof FireGoalSchema>;
export type FireSnapshotResponse = z.infer<typeof FireSnapshotSchema>;
export type FireBreakdownResponse = z.infer<typeof FireBreakdownSchema>;
export type FireSummaryResponse = z.infer<typeof FireSummaryResponseSchema>;
export type SnapshotUpsertInput = z.infer<typeof SnapshotUpsertSchema>;
