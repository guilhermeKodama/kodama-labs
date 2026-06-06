import { prisma } from "./prisma";
import type { JobStatus } from "@/generated/prisma";

export interface JobResult {
  recordsIn: number;
  recordsOut: number;
  metadata?: Record<string, unknown>;
}

const STALE_JOB_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const STALE_CURSOR_THRESHOLD_MS = 30 * 60 * 1000;

async function updateJobRunWithRetry(
  jobName: string,
  args: Parameters<typeof prisma.jobRun.update>[0],
) {
  const delaysMs = [200, 600, 1800];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await prisma.jobRun.update(args);
    } catch (err) {
      lastErr = err;
      if (attempt === delaysMs.length) break;
      const backoff = delaysMs[attempt]!;
      console.warn(
        `[${jobName}] jobRun.update failed (attempt ${attempt + 1}/${delaysMs.length + 1}), retrying in ${backoff}ms`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  console.error(
    `[${jobName}] jobRun.update exhausted retries; row may remain in RUNNING state`,
  );
  throw lastErr;
}

export async function runJob(
  jobName: string,
  layer: string,
  fn: () => Promise<JobResult>
): Promise<{ success: boolean; result?: JobResult; error?: string }> {
  // Guardrail: clean up zombie RUNNING runs for this job before starting
  const cutoff = new Date(Date.now() - STALE_JOB_THRESHOLD_MS);
  const { count: zombiesCleaned } = await prisma.jobRun.updateMany({
    where: { jobName, status: "RUNNING" as JobStatus, startedAt: { lt: cutoff } },
    data: { status: "FAILED" as JobStatus, completedAt: new Date(), error: "Zombie: process terminated while running" },
  });
  if (zombiesCleaned > 0) {
    console.warn(`[${jobName}] Cleaned ${zombiesCleaned} zombie runs before starting`);
  }

  // Guardrail: skip if another instance is already running (started < 30min ago)
  const alreadyRunning = await prisma.jobRun.findFirst({
    where: { jobName, status: "RUNNING" as JobStatus, startedAt: { gte: cutoff } },
    select: { id: true, startedAt: true },
  });
  if (alreadyRunning) {
    const ageMs = Date.now() - alreadyRunning.startedAt.getTime();
    console.warn(`[${jobName}] Skipped: another instance already running (${Math.round(ageMs / 1000)}s old)`);
    return { success: false, error: `Skipped: concurrent run in progress` };
  }

  const jobRun = await prisma.jobRun.create({
    data: { jobName, layer, status: "RUNNING" as JobStatus },
  });

  try {
    const result = await fn();

    await updateJobRunWithRetry(jobName, {
      where: { id: jobRun.id },
      data: {
        status: "COMPLETED" as JobStatus,
        completedAt: new Date(),
        recordsIn: result.recordsIn,
        recordsOut: result.recordsOut,
        metadata: (result.metadata ?? undefined) as Parameters<typeof prisma.jobRun.update>[0]["data"]["metadata"],
      },
    });

    console.log(`[${jobName}] Completed: ${result.recordsIn} in, ${result.recordsOut} out`);
    return { success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await updateJobRunWithRetry(jobName, {
      where: { id: jobRun.id },
      data: { status: "FAILED" as JobStatus, completedAt: new Date(), error: errorMessage },
    });

    console.error(`[${jobName}] Failed:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

type DataSourceLiteral = "PNCP" | "TRANSPARENCIA" | "COMPRAS_GOV" | "CEIS" | "CNEP" | "TCU" | "CNPJ" | "MARKET_PRICE" | "TSE" | "CAMARA" | "SENADO";

export async function getOrCreateCursor(
  source: string,
  endpoint: string,
  defaultDate?: Date
) {
  const existing = await prisma.ingestionCursor.findUnique({
    where: {
      source_endpoint: { source: source as DataSourceLiteral, endpoint },
    },
  });

  if (existing) {
    if (existing.status === "RUNNING" || existing.status === "FAILED") {
      const age = Date.now() - existing.updatedAt.getTime();
      if (age > STALE_CURSOR_THRESHOLD_MS) {
        console.warn(
          `[cursor] Resetting stale ${existing.status} cursor: ${source}/${endpoint} (age: ${Math.round(age / 60000)}min)`
        );
        await prisma.ingestionCursor.update({
          where: { id: existing.id },
          data: { status: "IDLE" as JobStatus },
        });
        return { ...existing, status: "IDLE" as const };
      }
    }

    // Skip cursors that reached a terminal state (e.g. discontinued APIs)
    if (existing.status === "COMPLETED") {
      return existing;
    }

    return existing;
  }

  return prisma.ingestionCursor.create({
    data: {
      source: source as DataSourceLiteral,
      endpoint,
      lastFetchedAt: defaultDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      status: "IDLE",
    },
  });
}

export async function markProcessed(ids: string[]) {
  if (!ids.length) return;
  const CHUNK = 5000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    await prisma.rawRecord.updateMany({
      where: { id: { in: ids.slice(i, i + CHUNK) } },
      data: { processedAt: new Date() },
    });
  }
}

export async function markErrors(entries: { id: string; error: string }[]) {
  if (!entries.length) return;
  const CHUNK = 200;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await prisma.$transaction(
      entries.slice(i, i + CHUNK).map((e) =>
        prisma.rawRecord.update({
          where: { id: e.id },
          data: { processingError: e.error },
        })
      )
    );
  }
}

export async function updateCursor(
  id: string,
  data: {
    lastFetchedAt?: Date;
    cursorValue?: string;
    totalFetched?: number;
    status?: string;
    lastError?: string | null;
  }
) {
  return prisma.ingestionCursor.update({
    where: { id },
    data: { ...data, status: (data.status as JobStatus) ?? undefined },
  });
}

/**
 * Retry wrapper for database operations prone to deadlocks.
 * Retries up to `maxRetries` times with exponential backoff on Postgres deadlock (40P01).
 */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  label = "db-op",
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDeadlock = msg.includes("40P01") || msg.toLowerCase().includes("deadlock");
      if (!isDeadlock || attempt === maxRetries) throw err;
      const backoffMs = 200 * Math.pow(2, attempt - 1) + Math.random() * 100;
      console.warn(`[${label}] Deadlock on attempt ${attempt}/${maxRetries}, retrying in ${Math.round(backoffMs)}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error("unreachable");
}
