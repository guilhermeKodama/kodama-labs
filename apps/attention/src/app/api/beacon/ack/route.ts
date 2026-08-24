import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";

const bodySchema = z
  .object({
    beaconId: z.string().min(1).nullish(),
    notifId: z.string().min(1).nullish(),
  })
  .refine((d) => d.beaconId || d.notifId, { message: "beaconId or notifId required" });

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { beaconId, notifId } = parsed.data;

  await Promise.all([
    beaconId
      ? prisma.beacon.updateMany({ where: { id: beaconId, ackedAt: null }, data: { ackedAt: new Date() } })
      : Promise.resolve(),
    notifId
      ? prisma.notification.updateMany({ where: { id: notifId, ackedAt: null }, data: { ackedAt: new Date() } })
      : Promise.resolve(),
  ]);

  return NextResponse.json({ ok: true });
}
