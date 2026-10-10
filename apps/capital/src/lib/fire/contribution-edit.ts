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
  /** Calendar year the by_date solve aims at. Missing when the plan has no date. */
  targetYear?: number | null;
}

export interface ContributionEditPatch {
  phases: ContributionPhase[];
  /** Set when a future by_date plan's typed amounts become the plan. */
  planningMode?: "by_contribution";
  /** Set together with {@link ContributionEditPatch.planningMode} so the solve cannot rescale the amounts. */
  phaseProfile?: "custom";
}

/** A by_date plan whose target year is still ahead, so the summary solves the contributions. */
export function isFutureDatedPlan(goal: Pick<ContributionEditGoal, "planningMode" | "targetYear">, nowYear = new Date().getFullYear()): boolean {
  return goal.planningMode === "by_date" && goal.targetYear != null && goal.targetYear > nowYear;
}

/**
 * Amounts the goal dialog shows. A future by_date plan shows the solved
 * schedule (`summary.requiredContribution.phases`); everything else shows the
 * stored phases. Bounds and labels stay on the stored phases.
 */
export function phasesShownForContributionEdit(
  goal: ContributionEditGoal,
  solvedPhases: readonly ContributionPhase[] | null | undefined,
  nowYear = new Date().getFullYear(),
): ContributionPhase[] {
  if (isFutureDatedPlan(goal, nowYear) && solvedPhases && solvedPhases.length === goal.phases.length && goal.phases.length > 0) {
    return goal.phases.map((phase, index) => ({
      ...phase,
      monthlyContribution: solvedPhases[index].monthlyContribution,
    }));
  }
  return goal.phases.map((phase) => ({ ...phase }));
}

/**
 * A contribution typed in the dialog. Blank, or anything that is not a
 * finite number ≥ 0, is `null` — never `0`. A typed `0` stays `0`.
 */
export function parseContributionText(text: string, parseNumber: (text: string) => number): number | null {
  if (text.trim() === "") return null;
  const amount = parseNumber(text);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

/**
 * Replace `monthlyContribution` on the given phase indexes. Bounds and labels
 * are copied through. Returns null when every supplied amount already matches
 * the phase (or the map is empty): callers then leave `phases`, `planningMode`
 * and `phaseProfile` out of the write.
 *
 * A by_date plan switches to by_contribution / custom only when an amount
 * actually changes and `targetYear` is still in the future. A past or missing
 * target year only updates amounts. A by_contribution plan only updates
 * amounts, including when its profile is guided (`constant`, `front_loaded`,
 * `back_loaded`).
 */
export function patchPhaseContributions(
  goal: ContributionEditGoal,
  amounts: ReadonlyMap<number, number>,
  nowYear = new Date().getFullYear(),
): ContributionEditPatch | null {
  if (amounts.size === 0) return null;
  const phases = goal.phases.map((phase) => ({ ...phase }));
  let changed = false;
  for (const [index, amount] of amounts) {
    if (!Number.isInteger(index) || index < 0 || index >= phases.length) {
      throw new Error(`Phase index ${index} is outside 0–${Math.max(phases.length - 1, 0)}`);
    }
    if (!Number.isFinite(amount) || amount < 0) throw new Error("monthlyContribution must be a non-negative number");
    if (phases[index].monthlyContribution !== amount) {
      phases[index] = { ...phases[index], monthlyContribution: amount };
      changed = true;
    }
  }
  if (!changed) return null;
  const patch: ContributionEditPatch = { phases };
  if (isFutureDatedPlan(goal, nowYear)) {
    patch.planningMode = "by_contribution";
    patch.phaseProfile = "custom";
  }
  return patch;
}

/**
 * PUT body for the FIRE goal dialog. `phases`, `planningMode` and
 * `phaseProfile` are included only when a typed amount differs from the
 * prefilled baseline (the solved schedule on a future by_date plan, otherwise
 * the stored amount, after the same format round-trip the inputs use).
 * A blank field is skipped, so it cannot be saved as 0.
 */
export function fireGoalDialogBody(input: {
  fields: Record<string, unknown>;
  goal: ContributionEditGoal | null;
  solvedPhases?: readonly ContributionPhase[] | null;
  /** Current input text, one entry per phase. */
  texts: readonly string[];
  /** Text the inputs were prefilled with. Same formatter as `texts`. */
  baselineTexts: readonly string[];
  parseNumber: (text: string) => number;
  /** Included on create, next to the new phase. */
  currency?: string;
  nowYear?: number;
}): Record<string, unknown> {
  const nowYear = input.nowYear ?? new Date().getFullYear();
  const { fields, goal, texts, parseNumber } = input;
  if (!goal) {
    const amount = parseContributionText(texts[0] ?? "", parseNumber);
    if (amount == null) return { ...fields };
    return {
      ...fields,
      planningMode: "by_contribution",
      phaseProfile: "constant",
      ...(input.currency != null ? { currency: input.currency } : {}),
      phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: amount }],
    };
  }
  const shown = phasesShownForContributionEdit(goal, input.solvedPhases, nowYear);
  const amounts = new Map<number, number>();
  for (let index = 0; index < shown.length; index++) {
    const parsed = parseContributionText(texts[index] ?? "", parseNumber);
    if (parsed == null) continue;
    const baseline = parseContributionText(input.baselineTexts[index] ?? "", parseNumber);
    if (baseline == null || parsed !== baseline) amounts.set(index, parsed);
  }
  const patch = patchPhaseContributions({ ...goal, phases: shown }, amounts, nowYear);
  return patch ? { ...fields, ...patch } : { ...fields };
}
