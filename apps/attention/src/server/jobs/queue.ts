import { prisma } from "../lib/prisma";
import { Prisma } from "../../generated/prisma";

export type JobType = "triage" | "draft" | "digest" | "send";

export type ClaimedJob = {
  id: string;
  type: JobType;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
};

export async function enqueue(
  type: JobType,
  payload: Prisma.InputJsonValue,
  opts?: { uniqueKey?: string; runAt?: Date }
): Promise<void> {
  await prisma.job.createMany({
    data: [
      {
        type,
        payload,
        uniqueKey: opts?.uniqueKey,
        runAt: opts?.runAt ?? new Date(),
      },
    ],
    skipDuplicates: true,
  });
}

// SKIP LOCKED so the jobs worker and the WhatsApp worker (which only ever
// claims "send") never block on each other's rows. type filtering per caller
// is the invariant that keeps the two consumers from claiming each other's
// work — there's no overlap in which types each one asks for.
export async function claim(types: JobType[], limit = 3): Promise<ClaimedJob[]> {
  if (types.length === 0) return [];
  const rows = await prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE "Job" SET status = 'RUNNING', "claimedAt" = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE status = 'QUEUED' AND "runAt" <= now() AND type IN (${Prisma.join(types)})
      ORDER BY "runAt" ASC LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, "maxAttempts", "runAt"
  `);
  return rows;
}

export async function complete(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: "DONE", finishedAt: new Date() },
  });
}

export async function fail(
  id: string,
  err: unknown,
  attempts: number,
  maxAttempts: number
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  if (attempts < maxAttempts) {
    const backoffMs = Math.min(30_000 * 2 ** attempts, 60 * 60 * 1000);
    await prisma.job.update({
      where: { id },
      data: { status: "QUEUED", runAt: new Date(Date.now() + backoffMs), lastError: message },
    });
  } else {
    await prisma.job.update({
      where: { id },
      data: { status: "FAILED", lastError: message, finishedAt: new Date() },
    });
  }
}

// The "desfazer" primitive: cancel only wins the race if the job is still
// QUEUED (i.e. claim() hasn't picked it up yet). rowcount 0 means send already
// started — the UI reports "already sent" instead of silently no-op'ing.
export async function cancelByUniqueKey(uniqueKey: string): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { uniqueKey, status: "QUEUED" },
    data: { status: "CANCELED", finishedAt: new Date() },
  });
  return count === 1;
}

export async function requeueZombies(): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const { count } = await prisma.job.updateMany({
    where: { status: "RUNNING", claimedAt: { lt: cutoff } },
    data: { status: "QUEUED" },
  });
  return count;
}
