import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a subscription, scoped to the requesting user — a user can only
 * unsubscribe their own device, never guess another user's endpoint away.
 * Deleting a non-owned or already-gone endpoint is a silent no-op (deleteMany
 * matches zero rows) rather than a 404, since the client-side effect (this
 * device no longer gets push) is already true either way.
 */
export async function deleteSubscription(
  userId: string,
  endpoint: string,
  db: DbClient
) {
  await db.pushSubscription.deleteMany({
    where: { endpoint, userId },
  });
}
