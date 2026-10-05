import { NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 3000;

// Prisma has no per-query cancel. One in-flight SELECT is shared so a hung
// check cannot stack a new query per concurrent request. The timer is cleared
// when that query settles.
let inflight: Promise<void> | null = null;

function pingDatabase(): Promise<void> {
  if (!inflight) {
    inflight = prisma.$queryRaw`SELECT 1`.then(() => undefined).finally(() => {
      inflight = null;
    });
  }
  const query = inflight;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
    query.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("db"));
      },
    );
  });
}

export async function GET() {
  try {
    await pingDatabase();
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch {
    return NextResponse.json({ status: "error", db: "error" }, { status: 503 });
  }
}
