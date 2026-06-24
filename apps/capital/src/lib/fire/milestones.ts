import { MONTHS_PER_YEAR } from './rates';
import type { LifecyclePoint } from './lifecycle';

/**
 * Flexible, user-defined milestones evaluated against the deterministic
 * lifecycle path (first crossing). Generalizes the fixed Lean/Fat/Coast tiers
 * into configurable goals ("plan with nuance").
 */

export type MilestoneType =
  | 'net_worth_absolute'
  | 'net_worth_x_expenses'
  | 'passive_income_absolute'
  | 'age'
  | 'coast';

export interface MilestoneDef {
  id: string;
  name: string;
  type: MilestoneType;
  value: number;
}

export interface MilestoneContext {
  /** targetMonthlyIncome * 12 — the annual expenses the FIRE number is built on. */
  annualExpenses: number;
  swr: number;
  currentInvested: number;
  fireNumber: number;
  monthlyRealReturn: number;
  retirementMonthIndex: number;
  currentAge: number;
}

export interface MilestoneEvaluation {
  id: string;
  name: string;
  type: MilestoneType;
  value: number;
  /** Net-worth level this milestone requires (null for an 'age' milestone). */
  targetNetWorth: number | null;
  reachedNow: boolean;
  achievedAge: number | null;
  achievedYearOffset: number | null;
  achievedMonthIndex: number | null;
  progress: number; // clamped [0,1], "how close am I today"
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** The net-worth level a milestone requires (or the target age, for type 'age'). */
function thresholdFor(def: MilestoneDef, ctx: MilestoneContext): number {
  if (def.type === 'net_worth_absolute') return def.value;
  if (def.type === 'net_worth_x_expenses') return def.value * ctx.annualExpenses;
  if (def.type === 'passive_income_absolute') return (def.value * MONTHS_PER_YEAR) / ctx.swr;
  if (def.type === 'coast') {
    // Present value that compounds to the FIRE number by retirement, no contributions.
    return ctx.fireNumber / Math.pow(1 + ctx.monthlyRealReturn, ctx.retirementMonthIndex);
  }
  return def.value; // 'age'
}

function isReached(def: MilestoneDef, point: LifecyclePoint, threshold: number): boolean {
  if (def.type === 'age') return point.age >= threshold;
  return point.netWorth >= threshold;
}

function currentProgress(def: MilestoneDef, ctx: MilestoneContext, threshold: number): number {
  if (def.type === 'age') {
    return def.value <= 0 ? 1 : clamp01(ctx.currentAge / def.value);
  }
  if (threshold <= 0) return ctx.currentInvested >= threshold ? 1 : 0;
  return clamp01(ctx.currentInvested / threshold);
}

export function evaluateMilestones(
  defs: MilestoneDef[],
  path: LifecyclePoint[],
  ctx: MilestoneContext
): MilestoneEvaluation[] {
  return defs.map((def) => {
    const threshold = thresholdFor(def, ctx);

    let achieved: LifecyclePoint | null = null;
    for (const point of path) {
      if (isReached(def, point, threshold)) {
        achieved = point;
        break;
      }
    }

    return {
      id: def.id,
      name: def.name,
      type: def.type,
      value: def.value,
      targetNetWorth: def.type === 'age' ? null : threshold,
      reachedNow: path.length > 0 ? isReached(def, path[0], threshold) : false,
      achievedAge: achieved ? achieved.age : null,
      achievedYearOffset: achieved ? achieved.yearOffset : null,
      achievedMonthIndex: achieved ? achieved.monthIndex : null,
      progress: currentProgress(def, ctx, threshold),
    };
  });
}
