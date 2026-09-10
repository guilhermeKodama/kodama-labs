// One-off (re-runnable): recomputes TriageDecision.featuresSnapshot against
// the ACTIVE SearchProfile, then retrains the scoring model.
//
// Why this is needed: four of the ~20 ML features (coreStackOverlap,
// desiredStackOverlap, titleMatchesTarget, sectorMatch) are defined RELATIVE
// to the profile, so editing the profile silently changes what they mean.
// train.ts prefers the stored snapshot over recomputing, so after a profile
// edit a retrain just reproduces coefficients learned in the old feature
// space — and those can end up inverted against the new profile (the v4
// model had titleMatchesTarget -0.280 and desiredStackOverlap -0.242,
// learned when the v1 profile aimed at Staff/Rust/Go titles the user was
// actually discarding).
//
// The snapshots are deliberately point-in-time, so overwriting them loses
// that record — the previous values are dumped to a JSON file first, which
// is what makes this reversible.
//
// usage: node --import tsx src/scripts/rebuild-feature-snapshots.ts [--dry-run]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env";
import { prisma } from "../server/lib/prisma";
import { buildFeatureVector, FEATURE_KEYS, type FeatureVector } from "../server/ml/features";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const profile = await prisma.searchProfile.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { version: "desc" },
  });
  console.log(`perfil ativo: v${profile.version} — ${profile.label ?? "(sem label)"}`);

  const decisions = await prisma.triageDecision.findMany({
    include: { job: { include: { company: true } } },
    orderBy: { decidedAt: "asc" },
  });
  console.log(`${decisions.length} decisões de triagem`);

  // Under CAREERS_BLOB_DIR, not /tmp: this normally runs inside a container
  // (the real DB is not reachable from the host on this machine), and the
  // blob dir is the one bind-mounted path that survives a recreate. A backup
  // that dies with the container wouldn't make this reversible.
  const backupDir = join(env.CAREERS_BLOB_DIR, "snapshot-backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `featuresSnapshot-v${profile.version}-${Date.now()}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      decisions.map((d) => ({ id: d.id, jobId: d.jobId, featuresSnapshot: d.featuresSnapshot })),
      null,
      2
    )
  );
  console.log(`backup dos snapshots antigos: ${backupPath}`);

  // Aggregate drift per feature, so the run reports what actually moved
  // rather than just "127 rows updated".
  const drift = new Map<string, { changed: number; sumAbsDelta: number }>();
  let updated = 0;
  let skipped = 0;

  for (const decision of decisions) {
    if (!decision.job) {
      skipped++;
      continue;
    }

    const before = decision.featuresSnapshot as unknown as FeatureVector | null;
    const after = buildFeatureVector(decision.job, decision.job.company, profile);

    for (const key of FEATURE_KEYS) {
      const delta = (after[key] ?? 0) - (before?.[key] ?? 0);
      if (delta === 0) continue;
      const entry = drift.get(key) ?? { changed: 0, sumAbsDelta: 0 };
      entry.changed++;
      entry.sumAbsDelta += Math.abs(delta);
      drift.set(key, entry);
    }

    if (!dryRun) {
      await prisma.triageDecision.update({
        where: { id: decision.id },
        data: { featuresSnapshot: after },
      });
    }
    updated++;
  }

  console.log(`\n${dryRun ? "[dry-run] " : ""}${updated} snapshots recomputados (${skipped} sem job)`);
  console.log("\nfeatures que mudaram:");
  for (const [key, { changed, sumAbsDelta }] of [...drift.entries()].sort(
    (a, b) => b[1].sumAbsDelta - a[1].sumAbsDelta
  )) {
    console.log(`  ${key.padEnd(22)} ${String(changed).padStart(4)} decisões  Δabs médio ${(sumAbsDelta / changed).toFixed(3)}`);
  }
  if (drift.size === 0) console.log("  (nenhuma)");

  if (dryRun) {
    console.log("\n[dry-run] nada foi gravado, treino não executado");
    return;
  }

  console.log("\ntreinando modelo novo...");
  const { trainScoringModel } = await import("../server/ml/train");
  const result = await trainScoringModel();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
