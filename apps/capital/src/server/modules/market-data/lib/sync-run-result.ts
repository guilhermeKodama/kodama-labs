import type { CronRunResult } from "@capital/server/lib/cron";
import type { SyncPricesResult } from "../services/sync-prices";

/**
 * How a sync-prices run reads as an IntegrationRun, shared by the
 * market-close pipeline (trigger "cron") and "Atualizar cotações" (trigger
 * "manual") so both report the same way. Pure: no DB, no network.
 */
export function syncRunResult(result: SyncPricesResult): CronRunResult {
  const status: CronRunResult["status"] =
    result.requested === 0 ? "skipped" : result.priced + result.suspect === 0 ? "failed" : result.missing > 0 ? "partial" : "ok";
  const rateLimited = result.priced + result.suspect === 0 && result.issues.length > 0 && result.issues.every((i) => i.outcome === "rate_limited");
  return {
    status,
    requested: result.requested,
    succeeded: result.priced + result.suspect,
    missing: result.missing,
    rejected: result.issues.filter((i) => i.outcome === "rejected").length,
    providerLatestDate: result.providerLatestDate,
    error: rateLimited ? "rate_limited" : undefined,
    stats: { bySource: result.bySource, suspect: result.suspect, issues: result.issues },
    body: { message: `Synced prices for ${result.priced + result.suspect}/${result.requested} assets`, ...result },
  };
}
