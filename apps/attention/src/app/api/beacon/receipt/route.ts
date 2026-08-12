import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";

const bodySchema = z.object({ beaconId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await prisma.beacon.updateMany({
    where: { id: parsed.data.beaconId, receivedAt: null },
    data: { receivedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
