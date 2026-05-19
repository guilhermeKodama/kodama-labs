/**
 * One-off cleanup: deletes contextual OVERPRICING alerts where the deviation
 * is implausibly large (>1000%). These are almost always the result of the
 * pre-fix bug where `analyze-overpricing.ts` compared `totalPrice` against a
 * unit-priced ESTIMATE_EXPECTED, producing "85148% acima"-style false
 * positives.
 *
 * Also deletes the matching `AiAnalysis` rows so `analyzeOverpricing` will
 * re-evaluate these items on the next cron tick with the fixed unit-price
 * logic. Mirrors the pattern in commit 87ef42b0c (AI_FLAG reset).
 *
 * Usage:
 *   cd apps/sentinel && pnpm exec tsx scripts/reset-bad-overpricing-alerts.ts
 *   # add --dry-run to preview without writing
 */

import { prisma } from "../src/server/lib/prisma";

const DEVIATION_THRESHOLD = 10; // 1000% — anything above is almost certainly a unit/total mismatch

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const alerts = await prisma.alert.findMany({
    where: { type: "OVERPRICING" },
    select: { id: true, data: true },
  });

  const bad: { id: string; itemId: string | null; deviation: number }[] = [];

  for (const a of alerts) {
    const d = a.data as Record<string, unknown> | null;
    if (!d) continue;

    const derived = d.derivedEstimate as { expectedPrice?: number } | null | undefined;
    const totalPrice = typeof d.totalPrice === "number" ? d.totalPrice : null;
    const expected = derived && typeof derived.expectedPrice === "number" ? derived.expectedPrice : null;

    if (!expected || !totalPrice || expected <= 0) continue;

    const deviation = (totalPrice - expected) / expected;
    if (deviation > DEVIATION_THRESHOLD) {
      bad.push({
        id: a.id,
        itemId: typeof d.itemId === "string" ? d.itemId : null,
        deviation,
      });
    }
  }

  const itemIds = bad.map((b) => b.itemId).filter((id): id is string => !!id);

  console.log(
    `Found ${bad.length} bad OVERPRICING alerts (deviation > ${DEVIATION_THRESHOLD * 100}%) ` +
      `and ${itemIds.length} matching AiAnalysis rows to clear.`,
  );
  if (bad.length > 0) {
    console.log("Sample deviations:", bad.slice(0, 5).map((b) => `${(b.deviation * 100).toFixed(0)}%`));
  }

  if (dryRun) {
    console.log("DRY RUN — no changes made. Re-run without --dry-run to apply.");
    return;
  }

  if (bad.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const result = await prisma.$transaction([
    prisma.alert.deleteMany({ where: { id: { in: bad.map((b) => b.id) } } }),
    prisma.aiAnalysis.deleteMany({
      where: {
        targetType: "procurement_item",
        targetId: { in: itemIds },
        analysisType: "overpricing_evaluation",
      },
    }),
  ]);

  console.log(`Deleted ${result[0].count} alerts and ${result[1].count} AiAnalysis rows.`);
  console.log("analyzeOverpricing will re-evaluate these items on the next cron tick.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
