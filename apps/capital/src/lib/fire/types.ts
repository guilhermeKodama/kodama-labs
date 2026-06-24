/**
 * FIRE calculation engine — pure types.
 *
 * Conventions (see {@link ./rates}):
 * - All money is in a single base currency (BRL).
 * - All rates are REAL (post-inflation). The adapter deflates nominal -> real.
 * - The period is the month. Annual rates are converted geometrically.
 * - Contributions happen at the END of each month (ordinary annuity).
 *
 * This module imports nothing from the Capital app, so the whole `fire/`
 * directory can be lifted into a standalone app unchanged.
 */

export type PlanningMode = 'by_date' | 'by_contribution';

/**
 * How the portfolio funds retirement (see {@link ./target}):
 * - `perpetuity` — live off the yield forever, never touching principal.
 * - `depletion` — spend the capital down to ~zero by life expectancy.
 */
export type WithdrawalStrategy = 'perpetuity' | 'depletion';

export type PhaseProfile = 'front_loaded' | 'constant' | 'back_loaded' | 'custom';

export type FireTier = 'lean' | 'regular' | 'fat' | 'barista';

/** One segment of the contribution schedule (curto/médio/longo prazo). */
export interface ContributionPhase {
  /** 0-based month index where this phase starts (inclusive). */
  fromMonth: number;
  /** Month index where this phase ends (exclusive). null = open-ended. */
  toMonth: number | null;
  /** Real BRL contributed at the end of each month during this phase. */
  monthlyContribution: number;
  /** Optional human label. */
  label?: string;
}

/**
 * A contribution phase before its amount is known — used by the "by date"
 * solver. `intensity` is the relative weight of this phase (the profile
 * shape); the solver scales a single base contribution by it.
 */
export interface PhaseShape {
  fromMonth: number;
  toMonth: number | null;
  intensity: number;
  label?: string;
}

/** Inputs to the engine. All produced by the Capital adapter. */
export interface FireAssumptions {
  /** P — current invested net worth (market value + cash), real BRL. */
  currentInvested: number;
  /** Desired monthly income in retirement (today's money). Drives the FIRE number. */
  targetMonthlyIncome: number;
  /** Safe withdrawal rate, e.g. 0.035. */
  safeWithdrawalRate: number;
  /** Expected REAL annual return during accumulation, e.g. 0.053. */
  realAnnualReturn: number;
  /** Contribution schedule (>= 1 phase). The last phase extends to the horizon. */
  phases: ContributionPhase[];
  /** Optional monthly income, for savings-rate reporting. */
  monthlyIncome?: number;
  /** Retirement funding strategy. Defaults to `perpetuity` when absent. */
  withdrawalStrategy?: WithdrawalStrategy;
}

export interface FireResult {
  fireNumber: number;
  currentInvested: number;
  /** currentInvested / fireNumber (raw, unclamped — can exceed 1). */
  progress: number;
  reached: boolean;
  /** 0 if reached; Infinity if never reachable. */
  monthsToFire: number;
  yearsToFire: number;
  /** currentInvested * SWR / 12 — what the portfolio sustainably pays today. */
  currentMonthlyPassiveIncome: number;
  /** Derived monthly real return, exposed for transparency/tests. */
  monthlyRealReturn: number;
  /** firstPhaseContribution / monthlyIncome, or null when no income given. */
  savingsRate: number | null;
}

export interface FireProjectionPoint {
  monthIndex: number;
  yearOffset: number;
  investedValue: number;
  /** Principal you put in (initial + contributions to date). */
  contributionsToDate: number;
  /** Market growth to date (investedValue - contributionsToDate). */
  growthToDate: number;
  reachedFire: boolean;
}

export interface FireProjection {
  points: FireProjectionPoint[];
  samplingEveryMonths: number;
  fireNumber: number;
  monthsToFire: number;
}

export type FireScenarioKey = 'pessimistic' | 'realistic' | 'optimistic';

export interface FireScenarioResult {
  key: FireScenarioKey;
  realAnnualReturn: number;
  monthsToFire: number;
  yearsToFire: number;
  /** ceil(monthsToFire), or Infinity when unreachable. */
  projectedFireMonthIndex: number;
}

export interface CoastFireResult {
  /** Amount needed today to coast (no further contributions) to the FIRE number. */
  coastNumber: number;
  reached: boolean;
  progress: number;
  targetMonths: number;
}

export interface FireTierResult {
  tier: FireTier;
  expenseMultiplier: number;
  fireNumber: number;
  progress: number;
  monthsToFire: number;
}
