import type { DbClient } from "@capital/server/lib/prisma";
import { notFound } from "@capital/server/modules/ledger/lib/errors";

/**
 * Devices that receive the user's pushes (live Web Push subscriptions).
 * `currentEndpoint` is this browser's subscription endpoint, so the list
 * can mark the device the user is on. Endpoints themselves never leave the
 * server.
 */
export async function listDevices(userId: string, db: DbClient, currentEndpoint?: string | null) {
  const rows = await db.pushSubscription.findMany({
    where: { userId, deadAt: null },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    deviceLabel: row.deviceLabel,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    isCurrent: !!currentEndpoint && row.endpoint === currentEndpoint,
  }));
}

/** Stops pushes to one of the user's devices. Another user's device is a 404. */
export async function removeDevice(userId: string, id: string, db: DbClient) {
  const { count } = await db.pushSubscription.deleteMany({ where: { id, userId } });
  if (!count) throw notFound("Device", "notifications.device_not_found");
  return { ok: true as const, id };
}
