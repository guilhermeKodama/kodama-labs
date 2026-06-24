import type { DbClient } from "@capital/server/lib/prisma";

/** The user's single FIRE plan (or null if not set up yet). */
export async function fetchFireGoal(userId: string, db: DbClient) {
  return db.fireGoal.findUnique({ where: { userId } });
}
