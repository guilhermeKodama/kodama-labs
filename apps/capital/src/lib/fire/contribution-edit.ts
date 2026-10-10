import type { ContributionPhase } from "./types";

/**
 * Which phase covers `monthIndex`. Matches {@link contributionAtMonth}: the
 * last phase extends past its end, and a schedule that starts later still
 * answers with the last phase.
 */
export function currentPhaseIndex(phases: readonly ContributionPhase[], monthIndex = 0): number {
  if (phases.length === 0) return -1;
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const isLast = i === phases.length - 1;
    const within = monthIndex >= phase.fromMonth && (isLast || phase.toMonth == null || monthIndex < phase.toMonth);
    if (within) return i;
  }
  return phases.length - 1;
}

/** Read-only description of a phase's month offsets (`toMonth` is exclusive). */
export function phaseMonthRange(phase: Pick<ContributionPhase, "fromMonth" | "toMonth">):
  | { kind: "open"; from: number }
  | { kind: "month"; month: number }
  | { kind: "span"; from: number; months: number } {
  if (phase.toMonth == null) return { kind: "open", from: phase.fromMonth };
  const months = phase.toMonth - phase.fromMonth;
  if (months <= 1) return { kind: "month", month: phase.fromMonth };
  return { kind: "span", from: phase.fromMonth, months };
}

export interface ContributionEditGoal {
  planningMode: string;
  phaseProfile: string;
  phases: ContributionPhase[];
}

export interface ContributionEditPatch {
  phases: ContributionPhase[];
  /** Set when a by_date plan's amounts become the plan, instead of a solved schedule. */
  planningMode?: "by_contribution";
  /** Set when the saved amounts must not be rescaled by a guided profile. */
  phaseProfile?: "custom";
}

const GUIDED_PROFILES = new Set(["front_loaded", "constant", "back_loaded"]);

/**
 * Replace `monthlyContribution` on the given phase indexes. Bounds and labels
 * are copied through. A by_date plan becomes by_contribution with a custom
 * profile, so the typed amounts are what the plan asks for. A guided profile
 * becomes custom so a later date-based solve cannot rescale the old ratios.
 */
export function patchPhaseContributions(goal: ContributionEditGoal, amounts: ReadonlyMap<number, number>): ContributionEditPatch {
  if (amounts.size === 0) throw new Error("No contribution to update");
  const phases = goal.phases.map((phase) => ({ ...phase }));
  for (const [index, amount] of amounts) {
    if (!Number.isInteger(index) || index < 0 || index >= phases.length) {
      throw new Error(`Phase index ${index} is outside 0–${Math.max(phases.length - 1, 0)}`);
    }
    if (!Number.isFinite(amount) || amount < 0) throw new Error("monthlyContribution must be a non-negative number");
    phases[index] = { ...phases[index], monthlyContribution: amount };
  }
  const patch: ContributionEditPatch = { phases };
  if (goal.planningMode === "by_date") {
    patch.planningMode = "by_contribution";
    patch.phaseProfile = "custom";
  } else if (GUIDED_PROFILES.has(goal.phaseProfile)) {
    patch.phaseProfile = "custom";
  }
  return patch;
}
