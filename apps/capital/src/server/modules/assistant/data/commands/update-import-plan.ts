import type { DbClient } from "@capital/server/lib/prisma";
import type { ImportPlanStatus } from "@/generated/prisma";

/**
 * Amend a still-proposed plan's payload (after the user answers a
 * question mid-conversation). Rejects any other status.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function updateImportPlanPayload(
  userId: string,
  planId: string,
  data: { payload: unknown; payloadHash: string; summary: unknown; warnings: string[] },
  db: DbClient
) {
  const plan = await db.importPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw new Error("Plan not found or access denied");
  if (plan.status !== "proposed") {
    throw new Error(`Plan is "${plan.status}" - only a "proposed" plan can be amended`);
  }

  return db.importPlan.update({
    where: { id: planId },
    data: {
      payload: data.payload as object,
      payloadHash: data.payloadHash,
      summary: data.summary as object,
      warnings: data.warnings,
    },
  });
}

/**
 * Transition a plan's status. Used by the REST confirm/reject endpoints
 * and by commit_plan/revert execution - never called with a status the
 * caller hasn't already validated the precondition for.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function updateImportPlanStatus(
  userId: string,
  planId: string,
  status: ImportPlanStatus,
  extra: { confirmedAt?: Date; confirmedVia?: string; committedAt?: Date } = {},
  db: DbClient
) {
  const plan = await db.importPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw new Error("Plan not found or access denied");

  return db.importPlan.update({
    where: { id: planId },
    data: { status, ...extra },
  });
}
