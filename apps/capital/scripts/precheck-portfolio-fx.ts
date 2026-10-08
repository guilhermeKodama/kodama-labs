/**
 * Read-only before/after of the portfolio FX repair, before it runs.
 * Simulates the migration and prints the per-account table. Does not write.
 *
 *   pnpm exec tsx scripts/precheck-portfolio-fx.ts [--user <userId>]
 *
 * Exit 1 when a rate-1 cross-currency leg is not one of the three expected
 * repairs, or the simulated Avenue opening does not match the PTAX flows.
 * The script never prints DATABASE_URL.
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
  const report = await portfolioFxReport(prisma, "precheck", { userId });
  process.stdout.write(report.text);
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(redact(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
