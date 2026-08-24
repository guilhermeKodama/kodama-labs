"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import type { JobStatus } from "../../../generated/prisma";
import { enqueue } from "../../jobs/queue";

/**
 * Every status/interest change made by hand here is exactly the training
 * signal the learned triage model (src/server/ml/train.ts) consumes later —
 * so this is the one place that must always write a JobStatusChange /
 * bump interestSource to USER, never a silent field update.
 */
export async function updateJobStatus(jobId: string, toStatus: JobStatus, reason?: string): Promise<void> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: toStatus,
      rejectionReason: toStatus === "DESCARTADA" ? (reason ?? job.rejectionReason) : job.rejectionReason,
      rejectedAt: toStatus === "DESCARTADA" ? new Date() : null,
    },
  });
  await prisma.jobStatusChange.create({
    data: { jobId, fromStatus: job.status, toStatus, actor: "user", reason },
  });
  revalidatePath("/");
  revalidatePath(`/vaga/${jobId}`);
  revalidatePath("/triagem");
  revalidatePath("/auto");
}

export async function updateJobInterest(jobId: string, interest: number): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { interest, interestSource: "USER" },
  });
  revalidatePath("/");
  revalidatePath(`/vaga/${jobId}`);
}

export async function updateJobManualRank(jobId: string, manualRank: number, interest?: number): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data:
      interest !== undefined
        ? { manualRank, interest, interestSource: "USER" }
        : { manualRank },
  });
  revalidatePath("/");
}

export async function recordApplication(jobId: string, resumeVersionId?: string): Promise<void> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  await prisma.application.create({
    data: { jobId, resumeVersionId },
  });
  if (job.status !== "APLICADA") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "APLICADA" } });
    await prisma.jobStatusChange.create({
      data: { jobId, fromStatus: job.status, toStatus: "APLICADA", actor: "user" },
    });
  }
  revalidatePath("/");
  revalidatePath(`/vaga/${jobId}`);
}

export async function requestResumeSuggestions(jobId: string): Promise<void> {
  await enqueue("generate-doc", { jobId, kind: "TAILORED_RESUME" }, { uniqueKey: `suggest:${jobId}:${Date.now()}` });
  revalidatePath(`/vaga/${jobId}`);
}
