import { prisma } from "../lib/prisma";

export async function getSidebarCounts() {
  const [jobs, triage, autoDiscarded] = await Promise.all([
    prisma.job.count(),
    prisma.job.count({ where: { status: { in: ["RADAR", "TRIAGEM", "SHORTLIST", "APLICADA"] } } }),
    prisma.job.count({ where: { status: "DESCARTADA", autoTriagedAt: { not: null } } }),
  ]);
  return { jobs, triage, autoDiscarded };
}
