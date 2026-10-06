/**
 * One-off backfill for the portfolio history. Idempotent; --dry-run only
 * prints the plan; --user limits it to one user.
 *
 *   pnpm exec tsx --env-file=.env scripts/backfill-portfolio-snapshots.ts [--dry-run] [--user <userId>]
 *
 * Step 1 (done): recalculates every holding that has operations, so
 * holdings stored before the current cost rules (fees in the cost, sales
 * taking their share of the cost out, a full sale deactivating the
 * holding) match what the app computes now. Holdings without operations
 * are left alone: their position was entered directly.
 *
 * Step 2 (pending, next S4 step): PortfolioSnapshot rows per entity and
 * month from cost basis and the exact broker cash at each month end,
 * flagged `estimated`.
 */
import { prisma } from "../src/server/lib/prisma";
import { recalculateAllHoldings } from "../src/server/modules/investments/lib/holding-position";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  if (userFlag >= 0 && !userId) throw new Error("--user needs a user id");

  const verb = dryRun ? "would recalculate" : "recalculated";
  const result = await recalculateAllHoldings(prisma, { userId, dryRun });
  for (const c of result.changed) {
    const parts = [
      c.before.currentQuantity !== c.after.currentQuantity && `quantity ${c.before.currentQuantity} -> ${c.after.currentQuantity}`,
      Math.abs(c.before.totalInvested - c.after.totalInvested) > 0.005 && `invested ${c.before.totalInvested.toFixed(2)} -> ${c.after.totalInvested.toFixed(2)}`,
      c.before.isActive !== c.after.isActive && (c.after.isActive ? "reactivated" : "deactivated"),
    ].filter(Boolean);
    console.log(`${verb} ${c.userId} ${c.id} ${c.label}: ${parts.join(", ")}`);
  }
  console.log(`holdings: ${result.checked} checked, ${result.skipped} without operations skipped, ${result.changed.length} ${dryRun ? "to recalculate" : "recalculated"}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
