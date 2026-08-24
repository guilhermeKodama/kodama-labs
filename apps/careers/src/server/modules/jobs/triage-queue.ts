import { prisma } from "../../lib/prisma";

// Until the learned model exists (server/ml/train.ts — needs real
// TriageDecision rows first), the closest honest proxy for "most worth
// reviewing" is oldest-first: nothing here claims to be sorted by model
// uncertainty until that's actually true.
export async function getTriageQueue() {
  return prisma.job.findMany({
    where: { status: { in: ["RADAR", "TRIAGEM"] } },
    include: { company: { select: { name: true, slug: true, health: true, stage: true } }, scores: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { discoveredAt: "asc" },
    take: 50,
  });
}
