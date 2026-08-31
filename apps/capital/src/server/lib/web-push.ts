import webpush from "web-push";
import { prisma } from "./prisma";
import { env } from "../../env";

// Runs once per process (Next.js keeps a single module cache per server
// instance). Same guarded-setup pattern as apps/careers/apps/attention's
// send-push.ts, ported with a capital-specific key pair — do not reuse
// another app's VAPID keys.
if (env.VAPID_PRIVATE_KEY && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

export interface PushSubscriptionTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

/**
 * Fan out one push notification to a set of subscriptions (already scoped to
 * the intended user — this function does no ownership lookup of its own).
 * Marks a subscription dead on 404/410 (the push service is telling us the
 * endpoint no longer exists) so future sends skip it.
 *
 * Unlike the careers/attention template this ports from, capital keeps no
 * per-send notification log — the ReminderDispatch row is the idempotency
 * ledger, and detailed delivery telemetry is out of scope for the MVP.
 */
export async function sendToSubscriptions(
  subscriptions: PushSubscriptionTarget[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!isPushConfigured() || subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
        return true;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { deadAt: new Date() },
          });
        }
        throw error;
      }
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return { sent, failed: results.length - sent };
}
