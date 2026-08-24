import { prisma } from "../lib/prisma";
import { Prisma } from "../../generated/prisma";

// Copied wholesale from apps/attention's job queue (its model is called
// "Job" there; here "Job" means a job posting, so the queue model is
// "Task" — see prisma/schema.prisma). Same SKIP LOCKED claim, same
// exponential backoff, same uniqueKey idempotency, same zombie requeue.

export type TaskType =
  | "discover"
  | "fetch-source"
  | "normalize"
  | "score"
  | "generate-doc"
  | "rescore-all"
  | "import-vault"
  | "train-model"
  | "distill-rules";

export type ClaimedTask = {
  id: string;
  type: TaskType;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
};

export async function enqueue(
  type: TaskType,
  payload: Prisma.InputJsonValue,
  opts?: { uniqueKey?: string; runAt?: Date }
): Promise<void> {
  await prisma.task.createMany({
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

// SKIP LOCKED so the jobs worker and the sources worker (which only ever
// claims "fetch-source") never block on each other's rows. Type filtering
// per caller is the invariant that keeps the two consumers from claiming
// each other's work — there's no overlap in which types each one asks for.
export async function claim(types: TaskType[], limit = 3): Promise<ClaimedTask[]> {
  if (types.length === 0) return [];
  const rows = await prisma.$queryRaw<ClaimedTask[]>(Prisma.sql`
    UPDATE "Task" SET status = 'RUNNING', "claimedAt" = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "Task"
      WHERE status = 'QUEUED' AND "runAt" <= now() AND type IN (${Prisma.join(types)})
      ORDER BY "runAt" ASC LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, "maxAttempts", "runAt"
  `);
  return rows;
}

export async function complete(id: string): Promise<void> {
  await prisma.task.update({
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
    await prisma.task.update({
      where: { id },
      data: { status: "QUEUED", runAt: new Date(Date.now() + backoffMs), lastError: message },
    });
  } else {
    await prisma.task.update({
      where: { id },
      data: { status: "FAILED", lastError: message, finishedAt: new Date() },
    });
  }
}

// The "undo" primitive: cancel only wins the race if the task is still
// QUEUED (i.e. claim() hasn't picked it up yet).
export async function cancelByUniqueKey(uniqueKey: string): Promise<boolean> {
  const { count } = await prisma.task.updateMany({
    where: { uniqueKey, status: "QUEUED" },
    data: { status: "CANCELED", finishedAt: new Date() },
  });
  return count === 1;
}

export async function requeueZombies(): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const { count } = await prisma.task.updateMany({
    where: { status: "RUNNING", claimedAt: { lt: cutoff } },
    data: { status: "QUEUED" },
  });
  return count;
}
