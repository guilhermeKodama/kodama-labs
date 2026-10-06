import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { FireGoalInputSchema, type FireGoalInput, type FireGoalPatch } from "../validations/fire";
import { upsertFireGoal as upsertFireGoalCommand } from "../data/commands/upsert-fire-goal";
import { fetchFireGoal } from "../data/queries/fetch-fire-goal";
import { serializeGoal } from "./serialize";

/** What a new plan cannot do without (the rest has defaults). */
const REQUIRED_ON_CREATE = ["targetMonthlyIncome", "safeWithdrawalRate", "nominalAnnualReturn", "annualInflation", "planningMode", "phaseProfile", "phases"] as const;

/**
 * Saves the FIRE plan from a partial body: fields left out keep their
 * stored value (so a dialog that edits the income target never resets a
 * by_date plan, its phases or the monthly income), an explicit null clears
 * a nullable field. Creating the plan needs the REQUIRED_ON_CREATE fields
 * (422 fire.goal_incomplete otherwise); the rest get their defaults.
 */
export async function upsertFireGoal(userId: string, patch: FireGoalPatch, db: DbClient) {
  const existing = await fetchFireGoal(userId, db);
  const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!existing && REQUIRED_ON_CREATE.some((k) => given[k] === undefined)) {
    throw new LedgerError(`A new FIRE plan needs ${REQUIRED_ON_CREATE.join(", ")}`, 422, { code: "fire.goal_incomplete" });
  }
  const base: Record<string, unknown> = existing ? serializeGoal(existing) : {};
  const merged = FireGoalInputSchema.safeParse({ ...base, ...given });
  if (!merged.success) {
    const issues = merged.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new LedgerError(`The merged FIRE plan is invalid: ${issues}`, 422, { code: "validation" });
  }
  const plan: FireGoalInput = merged.data;
  return upsertFireGoalCommand(userId, plan, db);
}
