import type { CronRunResult } from "@capital/server/lib/cron";
import type { DbClient } from "@capital/server/lib/prisma";
import { runPortfolioSnapshots } from "@capital/server/modules/investments/services/portfolio-history";
import { updateAllPrices } from "@capital/server/modules/investments/services/update-prices";
import { syncRunResult } from "../lib/sync-run-result";
import { syncPrices } from "./sync-prices";

/**
 * The stages of the daily market-close pipeline (/api/cron/market-close,
 * 22:30 UTC — after B3's and New York's closes are both ready, see
 * lib/calendar.ts), in the order they run. Each is also reachable on its own
 * route (/api/cron/sync-prices, /update-prices, /portfolio-snapshot) for a
 * manual rerun; the schedule calls only the pipeline, so the order is a
 * sequence in code instead of three clock times that had to stay 30 minutes
 * apart and silently broke when one ran long.
 *
 * Each turns a service's own result into a CronRunResult, so the pipeline,
 * the standalone routes and "Atualizar cotações" (trigger "manual") all
 * record IntegrationRun rows the same way.
 */

/** Writes today's AssetPrice for every active Asset through the provider chain. */
export async function syncPricesStage(db: DbClient): Promise<CronRunResult> {
  return syncRunResult(await syncPrices(db));
}

/** Refreshes every holding's cached price from AssetPrice (no network call). */
export async function updatePricesStage(db: DbClient): Promise<CronRunResult> {
  const result = await updateAllPrices(db);
  // Holdings with no ticker or whose class no source prices yet (fixed income, savings)
  // were never attempted, so a portfolio that is entirely those is "skipped", not "failed".
  const unattempted = result.issues.filter((i) => i.reason === "no_ticker" || i.reason === "no_source").length;
  const attempted = result.totalHoldings - unattempted;
  const status: CronRunResult["status"] =
    attempted === 0 ? "skipped" : result.updated === 0 ? "failed" : result.missing.length > 0 || result.failed > 0 ? "partial" : "ok";
  return {
    status,
    requested: attempted,
    succeeded: result.updated,
    missing: result.missing.length,
    rejected: result.failed,
    providerLatestDate: result.latestQuoteAt ? new Date(result.latestQuoteAt) : null,
    stats: { bySource: result.bySource, issues: result.issues },
    body: { message: `Updated prices for ${result.updated}/${result.totalHoldings} holdings`, ...result },
  };
}

/** Upserts each entity's PortfolioSnapshot for the current month at today's prices (see portfolio-history.ts). */
export async function portfolioSnapshotStage(db: DbClient): Promise<CronRunResult> {
  const result = await runPortfolioSnapshots(db);
  if (result.errors.length) console.error("[PortfolioSnapshot] failed users:", result.errors);
  const status: CronRunResult["status"] =
    result.users === 0 ? "skipped" : result.errors.length === result.users ? "failed" : result.errors.length ? "partial" : "ok";
  return {
    status,
    requested: result.users,
    succeeded: result.users - result.errors.length,
    missing: result.errors.length,
    stats: { live: result.live, closed: result.closed, errors: result.errors },
    body: { ...result },
  };
}
