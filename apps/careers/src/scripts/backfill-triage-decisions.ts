// One-off: updateJobStatus never recorded TriageDecision until now, so
// every manual triage done before this fix (via /triagem, or the original
// vault import's labeled discards) left no training signal behind. This
// recovers it from JobStatusChange history — the real record of what
// actually happened — using each job's CURRENT feature snapshot as the
// best available approximation of its state at decision time.
//
// usage: node --env-file=.env --import tsx src/scripts/backfill-triage-decisions.ts

import { prisma } from "../server/lib/prisma";
import { buildFeatureVector } from "../server/ml/features";

async function main() {
  const profile = await prisma.searchProfile.findFirst({ where: { isActive: true }, orderBy: { version: "desc" } });
  if (!profile) throw new Error("Nenhum SearchProfile ativo.");

  const changes = await prisma.jobStatusChange.findMany({
    where: { toStatus: { in: ["SHORTLIST", "DESCARTADA"] }, actor: { in: ["user", "import"] } },
    orderBy: { changedAt: "desc" },
    include: { job: { include: { company: true } } },
  });

  const seenJobIds = new Set<string>();
  let created = 0;
  let skipped = 0;

  for (const change of changes) {
    if (!change.job) continue;
    if (seenJobIds.has(change.jobId)) continue; // most recent change per job wins
    seenJobIds.add(change.jobId);

    const existing = await prisma.triageDecision.findFirst({ where: { jobId: change.jobId } });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.triageDecision.create({
      data: {
        jobId: change.jobId,
        label: change.toStatus === "SHORTLIST" ? "SHORTLIST" : "DESCARTAR",
        reason: change.reason ?? change.job.rejectionReason,
        featuresSnapshot: buildFeatureVector(change.job, change.job.company, profile),
        decidedAt: change.changedAt,
        wasCorrection: false, // none of these were reversals of an auto-decision — auto-triage never ran before this
      },
    });
    created++;
  }

  console.log(`TriageDecision backfill: ${created} criadas, ${skipped} já existiam, ${changes.length} status changes examinados.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
