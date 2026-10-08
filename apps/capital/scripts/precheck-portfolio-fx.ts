/**
 * Read-only before/after of the portfolio FX repair, before it runs.
 * Simulates the migration and prints the per-account table. Does not write.
 *
 *   pnpm exec tsx scripts/precheck-portfolio-fx.ts [--user <userId>] [--expect-targets]
 *
 * A rate-1 USD/BRL leg that is not Avenue 2026-08-12, Avenue 2026-09-16, or
 * the Crypto deposit is a warn line and is not written. Duplicates, ambiguity,
 * and a live BTC sell together with the 2026-10-02 adjustment exit 1.
 * --expect-targets also exits 1 unless each of those three legs and the BTC
 * buy is found once, or is already repaired. The script never prints DATABASE_URL.
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
  const report = await portfolioFxReport(prisma, "precheck", { userId, expectTargets: process.argv.includes("--expect-targets") });
  process.stdout.write(report.text);
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(redact(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
