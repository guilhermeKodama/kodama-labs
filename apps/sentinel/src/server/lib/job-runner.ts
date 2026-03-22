import { prisma } from "./prisma";
import type { JobStatus } from "@/generated/prisma";

export interface JobResult {
  recordsIn: number;
  recordsOut: number;
  metadata?: Record<string, unknown>;
}

export async function runJob(
  jobName: string,
  layer: string,
  fn: () => Promise<JobResult>
): Promise<{ success: boolean; result?: JobResult; error?: string }> {
  const jobRun = await prisma.jobRun.create({
    data: {
      jobName,
      layer,
      status: "RUNNING" as JobStatus,
    },
  });

  try {
    const result = await fn();

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "COMPLETED" as JobStatus,
        completedAt: new Date(),
        recordsIn: result.recordsIn,
        recordsOut: result.recordsOut,
        metadata: (result.metadata ?? undefined) as Parameters<typeof prisma.jobRun.update>[0]["data"]["metadata"],
      },
    });

    console.log(
      `[${jobName}] Completed: ${result.recordsIn} in, ${result.recordsOut} out`
    );
    return { success: true, result };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await prisma.jobRun.update({
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

export async function getOrCreateCursor(
  source: string,
  endpoint: string,
  defaultDate?: Date
) {
  const existing = await prisma.ingestionCursor.findUnique({
    where: {
      source_endpoint: {
        source: source as "PNCP" | "TRANSPARENCIA" | "COMPRAS_GOV" | "CEIS" | "CNEP" | "TCU" | "CNPJ" | "MARKET_PRICE" | "TSE" | "CAMARA",
        endpoint,
      },
    },
  });

  if (existing) return existing;

  return prisma.ingestionCursor.create({
    data: {
      source: source as "PNCP" | "TRANSPARENCIA" | "COMPRAS_GOV" | "CEIS" | "CNEP" | "TCU" | "CNPJ" | "MARKET_PRICE" | "TSE" | "CAMARA",
      endpoint,
      lastFetchedAt: defaultDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      status: "IDLE",
    },
  });
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
    data: {
      ...data,
      status: (data.status as JobStatus) ?? undefined,
    },
  });
}
