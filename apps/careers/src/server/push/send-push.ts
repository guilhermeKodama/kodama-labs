import webpush from "web-push";
import { prisma } from "../lib/prisma";
import { env } from "../../env";

// Each worker is a separate systemd service = a separate Node process with
// its own module cache, so this setup runs once per process (same pattern
// as apps/attention's send-push.ts, independently, not shared state).
if (env.VAPID_PRIVATE_KEY && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export type PushNotificationKind = "digest" | "new-job" | "health";

async function currentTriageBadgeCount(): Promise<number> {
  return prisma.job.count({ where: { status: "TRIAGEM" } });
}

export async function sendPush(input: {
  kind: PushNotificationKind;
  title: string;
  body: string;
  url: string;
  tag?: string;
}): Promise<{ sent: number }> {
  if (!env.VAPID_PRIVATE_KEY || !env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return { sent: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({ where: { deadAt: null } });
  const badge = await currentTriageBadgeCount();

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const notification = await prisma.pushNotification.create({
        data: {
          kind: input.kind,
          title: input.title,
          body: input.body,
          url: input.url,
          tag: input.tag,
          subscriptionId: sub.id,
        },
      });

      const payload = JSON.stringify({
        notifId: notification.id,
        kind: input.kind,
        title: input.title,
        body: input.body,
        url: input.url,
        tag: input.tag,
        badge,
      });

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        const message = error instanceof Error ? error.message : "unknown error";

        await Promise.all([
          prisma.pushNotification.update({ where: { id: notification.id }, data: { sendError: message } }),
          statusCode === 404 || statusCode === 410
            ? prisma.pushSubscription.update({ where: { id: sub.id }, data: { deadAt: new Date() } })
            : Promise.resolve(),
        ]);
      }
    })
  );

  return { sent: subscriptions.length };
}
