import { NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), 3000);
      }),
    ]);
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch {
    return NextResponse.json({ status: "error", db: "error" }, { status: 503 });
  }
}
