import webpush from "web-push";
import { prisma } from "../lib/prisma";
import { env } from "../../env";

// Each worker is a separate systemd service = a separate Node process with
// its own module cache, so this setup runs once per process (same pattern as
// dispatch-beacon.ts, independently, not shared state across services).
webpush.setVapidDetails(env.VAPID_SUBJECT, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

export type NotificationKind = "digest" | "now" | "health";

async function currentQueueBadgeCount(): Promise<number> {
  return prisma.message.count({
    where: {
      OR: [{ queueState: "QUEUED" }, { queueState: "SNOOZED", snoozedUntil: { lte: new Date() } }],
    },
  });
}

export async function sendPush(input: {
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  tag?: string;
}): Promise<{ sent: number }> {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { deadAt: null } });
  const badge = await currentQueueBadgeCount();

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const notification = await prisma.notification.create({
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
          prisma.notification.update({ where: { id: notification.id }, data: { sendError: message } }),
          statusCode === 404 || statusCode === 410
            ? prisma.pushSubscription.update({ where: { id: sub.id }, data: { deadAt: new Date() } })
            : Promise.resolve(),
        ]);
      }
    })
  );

  return { sent: subscriptions.length };
}
