/**
 * Before/after of the portfolio FX repair, after the migration has run.
 * The before column is the backup the migration stored. The after column is
 * the ledger. Both go through buildTimeline.
 *
 *   pnpm exec tsx scripts/verify-portfolio-fx.ts [--user <userId>] [--expect-targets]
 *
 * Exit 1 when Avenue ending cash is not the pre-repair cash plus the lift,
 * a corrected leg is not BRL divided by the previous business day's PTAX,
 * cash goes negative, or a holding with a delta operation does not match
 * replayPosition. --expect-targets also exits 1 unless each repaired target
 * is found once. Never prints DATABASE_URL.
 */
import { prisma } from "../src/server/lib/prisma";
import { portfolioFxReport } from "../src/server/modules/investments/lib/portfolio-fx-report";

function redact(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

async function main() {
  const userFlag = process.argv.indexOf("--user");
  const userId = userFlag >= 0 ? process.argv[userFlag + 1] : undefined;
  if (userFlag >= 0 && !userId) throw new Error("--user needs a user id");
  const report = await portfolioFxReport(prisma, "verify", { userId, expectTargets: process.argv.includes("--expect-targets") });
  process.stdout.write(report.text);
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(redact(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
