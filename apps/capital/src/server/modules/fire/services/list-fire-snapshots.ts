import type { DbClient } from "@capital/server/lib/prisma";
import type { FireSnapshotResponse } from "../validations/fire";
import { fetchFireGoal } from "../data/queries/fetch-fire-goal";
import { fetchFireSnapshots } from "../data/queries/fetch-fire-snapshots";
import { serializeSnapshot } from "./serialize";

export async function listFireSnapshots(
  userId: string,
  db: DbClient
): Promise<FireSnapshotResponse[]> {
  const goal = await fetchFireGoal(userId, db);
  if (!goal) return [];
  const snapshots = await fetchFireSnapshots(goal.id, db);
  return snapshots.map(serializeSnapshot);
}
