import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  deviceLabel: z.string().optional(),
  userAgent: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { endpoint, keys, deviceLabel, userAgent } = parsed.data;

  const subscription = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceLabel, userAgent },
    update: {
      p256dh: keys.p256dh,
      auth: keys.auth,
      deviceLabel,
      userAgent,
      lastSeenAt: new Date(),
      deadAt: null,
    },
  });

  return NextResponse.json({ id: subscription.id });
}
