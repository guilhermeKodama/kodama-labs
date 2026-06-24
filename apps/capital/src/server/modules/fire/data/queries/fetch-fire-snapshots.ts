import type { DbClient } from "@capital/server/lib/prisma";

/** Forward-only monthly progress snapshots, oldest first. */
export async function fetchFireSnapshots(goalId: string, db: DbClient, take = 120) {
  return db.fireSnapshot.findMany({
    where: { goalId },
    orderBy: { period: "asc" },
    take,
  });
}
