import webpush from "web-push";
import { prisma } from "./prisma";
import { env } from "../../env";

webpush.setVapidDetails(
  env.VAPID_SUBJECT,
  env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

export async function dispatchBeacon(): Promise<{ dispatched: number }> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { deadAt: null },
  });

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const beacon = await prisma.beacon.create({
        data: { subscriptionId: sub.id },
      });

      const payload = JSON.stringify({
        beaconId: beacon.id,
        title: "Beacon de teste",
        body: `Enviado às ${new Date().toLocaleTimeString("pt-BR")}`,
        url: "/lab",
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
          prisma.beacon.update({
            where: { id: beacon.id },
            data: { sendError: message },
          }),
          statusCode === 404 || statusCode === 410
            ? prisma.pushSubscription.update({
                where: { id: sub.id },
                data: { deadAt: new Date() },
              })
            : Promise.resolve(),
        ]);
      }
    })
  );

  return { dispatched: subscriptions.length };
}
