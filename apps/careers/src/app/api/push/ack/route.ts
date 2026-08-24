import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";

const bodySchema = z.object({ notifId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await prisma.pushNotification.updateMany({
    where: { id: parsed.data.notifId, ackedAt: null },
    data: { ackedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
