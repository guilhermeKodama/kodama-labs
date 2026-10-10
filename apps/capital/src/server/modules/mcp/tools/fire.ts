import type { DbClient } from "@capital/server/lib/prisma";
import { contributionAtMonth, currentPhaseIndex, patchPhaseContributions, phasesShownForContributionEdit, type ContributionPhase } from "@/lib/fire";
import { fetchFireGoal } from "../../fire/data/queries/fetch-fire-goal";
import { getFireSummary } from "../../fire/services/get-fire-summary";
import { serializeGoal } from "../../fire/services/serialize";
import { upsertFireGoal } from "../../fire/services/upsert-fire-goal";
import type { FirePhaseInput } from "../../fire/validations/fire";

/** The stored plan plus the contribution the consolidated FIRE view uses this month. */
export async function getFirePlan(userId: string, db: DbClient) {
  const summary = await getFireSummary(userId, db, { skipSnapshot: true });
  if (!summary.goal) {
    return {
      hasGoal: false as const,
      planningMode: null,
      phaseProfile: null,
      targetYear: null,
      phases: [] as FirePhaseInput[],
      currentPhaseIndex: null,
      currentMonthContribution: null,
    };
  }
  return {
    hasGoal: true as const,
    planningMode: summary.goal.planningMode,
    phaseProfile: summary.goal.phaseProfile,
    targetYear: summary.goal.targetYear,
    phases: summary.goal.phases,
    currentPhaseIndex: currentPhaseIndex(summary.goal.phases),
    currentMonthContribution: summary.currentMonthContribution,
  };
}

/**
 * Set one phase's consolidated monthly contribution. Bounds and labels stay.
 * On a future by_date plan the baseline is the solved schedule, same as the
 * goal dialog, so an untouched phase keeps the solved amount rather than the
 * stale stored one. The same amount as that baseline is a no-op. The plan
 * becomes by_contribution / custom only when an amount changes and the target
 * year is still in the future. A past or missing target year only updates the amount.
 */
export async function updateFirePhaseContribution(
  userId: string,
  params: { monthlyContribution: number; phaseIndex?: number },
  db: DbClient,
) {
  const existing = await fetchFireGoal(userId, db);
  if (!existing) throw new Error("No FIRE plan. Create one before setting a phase contribution.");
  const goal = serializeGoal(existing);
  if (goal.phases.length === 0) throw new Error("The FIRE plan has no contribution phases.");
  const index = params.phaseIndex ?? currentPhaseIndex(goal.phases);
  const summary = await getFireSummary(userId, db, { skipSnapshot: true });
  const baseline = phasesShownForContributionEdit(goal, summary.requiredContribution?.phases);
  const patch = patchPhaseContributions({ ...goal, phases: baseline }, new Map([[index, params.monthlyContribution]]));
  if (!patch) {
    return {
      id: goal.id,
      planningMode: goal.planningMode,
      phaseProfile: goal.phaseProfile,
      targetYear: goal.targetYear,
      phases: goal.phases,
      updatedPhaseIndex: index,
      currentPhaseIndex: currentPhaseIndex(goal.phases),
      currentMonthContribution: summary.currentMonthContribution,
      batchId: null,
    };
  }
  const saved = await upsertFireGoal(userId, patch, db);
  const phases = (saved.phases as unknown as ContributionPhase[]) ?? patch.phases;
  return {
    id: saved.id,
    planningMode: saved.planningMode,
    phaseProfile: saved.phaseProfile,
    targetYear: saved.targetYear,
    phases,
    updatedPhaseIndex: index,
    currentPhaseIndex: currentPhaseIndex(phases),
    currentMonthContribution: contributionAtMonth(phases, 0),
    batchId: saved.batchId,
  };
}
