import { prisma } from "./prisma";
import type { JobStatus } from "@/generated/prisma";

export interface JobResult {
  recordsIn: number;
  recordsOut: number;
  metadata?: Record<string, unknown>;
}

const STALE_JOB_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

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
  fn: () => Promise<JobResult>,
): Promise<{ success: boolean; result?: JobResult; error?: string }> {
  // Guardrail: clean up zombie RUNNING runs for this job before starting
  const cutoff = new Date(Date.now() - STALE_JOB_THRESHOLD_MS);
  const { count: zombiesCleaned } = await prisma.jobRun.updateMany({
    where: { jobName, status: "RUNNING" as JobStatus, startedAt: { lt: cutoff } },
    data: {
      status: "FAILED" as JobStatus,
      completedAt: new Date(),
      error: "Zombie: process terminated while running",
    },
  });
  if (zombiesCleaned > 0) {
    console.warn(`[${jobName}] Cleaned ${zombiesCleaned} zombie runs before starting`);
  }

  // Guardrail: skip if another instance is already running (started < 10min ago)
  const alreadyRunning = await prisma.jobRun.findFirst({
    where: { jobName, status: "RUNNING" as JobStatus, startedAt: { gte: cutoff } },
    select: { id: true, startedAt: true },
  });
  if (alreadyRunning) {
    const ageMs = Date.now() - alreadyRunning.startedAt.getTime();
    console.warn(
      `[${jobName}] Skipped: another instance already running (${Math.round(ageMs / 1000)}s old)`,
    );
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
        metadata: (result.metadata ?? undefined) as Parameters<
          typeof prisma.jobRun.update
        >[0]["data"]["metadata"],
      },
    });

    console.log(`[${jobName}] Completed: ${result.recordsIn} in, ${result.recordsOut} out`);
    return { success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await updateJobRunWithRetry(jobName, {
      where: { id: jobRun.id },
      data: {
        status: "FAILED" as JobStatus,
        completedAt: new Date(),
        error: errorMessage,
      },
    });

    console.error(`[${jobName}] Failed:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}
