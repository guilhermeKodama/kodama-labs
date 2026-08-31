import type { DbClient } from "@capital/server/lib/prisma";

interface UpsertSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel?: string;
  userAgent?: string;
}

/**
 * Upsert by endpoint (the push service's channel identifier is globally
 * unique, so re-subscribing the same device/browser must update the
 * existing row rather than create a duplicate). Reassigns userId on every
 * call — a browser subscribing under a second account takes over the
 * endpoint, matching the single-device-single-owner reality of Web Push.
 * Also revives a subscription previously marked dead and refreshes
 * lastSeenAt, which is how the client's on-mount re-sync keeps a
 * subscription alive across the Cloudflare Access boundary (see
 * use-push-subscription.ts — the SW itself cannot call this endpoint).
 */
export async function upsertSubscription(
  userId: string,
  data: UpsertSubscriptionData,
  db: DbClient
) {
  return db.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: {
      userId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      deviceLabel: data.deviceLabel,
      userAgent: data.userAgent,
    },
    update: {
      userId,
      p256dh: data.p256dh,
      auth: data.auth,
      deviceLabel: data.deviceLabel,
      userAgent: data.userAgent,
      lastSeenAt: new Date(),
      deadAt: null,
    },
  });
}
