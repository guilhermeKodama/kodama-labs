import type { DbClient } from "@capital/server/lib/prisma";
import type { FireSnapshotResponse } from "../validations/fire";
import { getFireSummary } from "./get-fire-summary";
import { fetchFireGoal } from "../data/queries/fetch-fire-goal";
import { fetchFireSnapshots } from "../data/queries/fetch-fire-snapshots";
import { serializeSnapshot } from "./serialize";

/** Force-refresh this month's snapshot and return it (null when there is no plan). */
export async function recordCurrentSnapshot(
  userId: string,
  db: DbClient
): Promise<FireSnapshotResponse | null> {
  await getFireSummary(userId, db, { forceSnapshot: true });
  const goal = await fetchFireGoal(userId, db);
  if (!goal) return null;
  const snapshots = await fetchFireSnapshots(goal.id, db);
  const latest = snapshots[snapshots.length - 1];
  return latest ? serializeSnapshot(latest) : null;
}
