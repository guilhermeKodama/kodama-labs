import { prisma } from "../../lib/prisma";
import type { JobStatus } from "../../../generated/prisma";

export { STATUS_LABELS, FUNNEL_ORDER } from "../../../lib/job-status";

export type JobListItem = Awaited<ReturnType<typeof listJobs>>[number];

const jobListArgs = {
  include: { company: { select: { name: true, health: true, slug: true } } },
} as const;

export type SortMode = "ordem" | "score" | "data";

const SORT_ORDER_BY: Record<SortMode, object[]> = {
  ordem: [{ manualRank: "asc" }, { interest: "desc" }, { discoveredAt: "desc" }],
  score: [{ compatibilityScore: "desc" }, { discoveredAt: "desc" }],
  data: [{ discoveredAt: "desc" }],
};

export async function listJobs(view: "triagem" | "funil" | "processo" | "todas", sort: SortMode = "ordem") {
  const where =
    view === "triagem"
      ? { status: { in: ["RADAR", "TRIAGEM", "SHORTLIST", "APLICADA"] as JobStatus[] } }
      : view === "funil"
        ? { status: { notIn: ["DESCARTADA", "REJEITADA"] as JobStatus[] } }
        : view === "processo"
          ? { status: { in: ["APLICADA", "ENTREVISTA", "OFERTA"] as JobStatus[] } }
          : {};

  return prisma.job.findMany({
    where,
    ...jobListArgs,
    orderBy: SORT_ORDER_BY[sort],
  });
}

export async function getJobDetail(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: {
      company: true,
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      notes: { orderBy: { updatedAt: "desc" } },
      statusChanges: { orderBy: { changedAt: "desc" } },
      applications: { orderBy: { appliedAt: "desc" } },
      suggestions: { orderBy: { createdAt: "desc" } },
    },
  });
}
