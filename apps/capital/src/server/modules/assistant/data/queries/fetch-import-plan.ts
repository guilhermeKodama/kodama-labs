import type { DbClient } from "@capital/server/lib/prisma";

/**
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchImportPlanById(userId: string, planId: string, db: DbClient) {
  return db.importPlan.findFirst({ where: { id: planId, userId } });
}
