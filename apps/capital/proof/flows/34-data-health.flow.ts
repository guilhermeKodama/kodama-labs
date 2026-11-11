import { expect, flow } from "@repo/proof-video";
import { settingsNav } from "../helpers";

/**
 * F1: the global Asset/AssetPrice layer behind each holding's price, the
 * "Saúde dos dados" panel that shows per-class coverage (brapi/Yahoo/
 * CoinGecko, none of this hand-picked — chainFor() reads the registry),
 * and scripts/backfill-asset-links.ts, the tool that actually links a
 * holding to its Asset.
 *
 * KNRI11 (FII, XP, PF) is priced moments ago by the demo seed and nothing
 * else in this suite touches it: backdating it is this flow's own way to
 * show a FII going stale without waiting for a real market close, and
 * nothing else in the suite races it.
 */

const STALE_FII = "KNRI11";
const STALE_HOURS = 60;
// A B3 stock: the backfill script should link it to brapi/Yahoo.
const LINKABLE = "WEGE3";
// Fixed income has no automatic source yet — the backfill script must leave it alone.
const UNLINKABLE = "LCA";

const row = (page: import("@playwright/test").Page, label: string) => page.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) });

flow("Saúde dos dados: per-class coverage, and the backfill script linking a holding for real", async ({ page, scene, say, check, terminal }) => {
  await scene("Cobertura por classe, before anything is linked", "Fonte ativa comes straight from the market-data registry — no link needed for that column");
  // No cron has ever run in this fresh database, so GET /api/health/market-data would answer
  // 503 (the overall status is "down" — see 33-market-data-health.flow.ts, which checks exactly
  // that through terminal()'s curl). The page itself fetches that same endpoint, so visiting it
  // here would make the *browser* hit a 5xx, which the recorder treats as a failure outright.
  // Marking every job "ok" first is this flow's own way to look at the panel beyond that gate.
  const markJobsOk = await terminal("sh", [
    "-c",
    `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
      INSERT INTO integration_runs (id, job, trigger, status, \\"startedAt\\", \\"finishedAt\\", \\"durationMs\\")
      SELECT gen_random_uuid(), job, 'cron', 'ok', now(), now(), 100
      FROM unnest(ARRAY['sync-prices','update-prices','update-rates','benchmarks','pluggy-sync']) AS job;
    "`,
  ]);
  await check("Every job has a run on record, so the panel itself is reachable", async () => {
    expect(markJobsOk.code).toBe(0);
    expect(markJobsOk.output).toContain("INSERT 0 5");
  });

  await page.goto("/settings");
  await settingsNav(page, "Saúde dos dados").click();
  await check("Every class names the registry's active source, or none for classes with no automatic source", async () => {
    await expect(row(page, "Ações").getByRole("cell", { name: "brapi.dev" })).toBeVisible();
    await expect(row(page, "Ações internacionais").getByRole("cell", { name: "Yahoo Finance" })).toBeVisible();
    await expect(row(page, "Cripto").getByRole("cell", { name: "CoinGecko" })).toBeVisible();
    await expect(row(page, "Renda fixa").getByRole("cell", { name: "—", exact: true })).toBeVisible();
  });
  await check("sync-prices, the new daily job, is listed alongside the others", async () => {
    await expect(row(page, "Sincronizar cotações").getByRole("cell", { name: "Ok" })).toBeVisible();
  });

  await scene("A FII goes stale", `${STALE_FII}'s cotação is set back ${STALE_HOURS}h`);
  await say(`${STALE_FII} was priced moments ago by the demo seed; backdating it is the fastest way to show a FII going stale`);
  await expect(row(page, "FIIs")).toBeVisible();
  const before = await row(page, "FIIs").getByRole("cell").allTextContents();
  const backdate = await terminal("sh", [
    "-c",
    `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE investment_holdings SET \\"lastPriceUpdate\\" = now() - interval '${STALE_HOURS} hours' WHERE ticker = '${STALE_FII}';"`,
  ]);
  await check(`${STALE_FII}'s price timestamp moved back`, async () => {
    expect(backdate.code).toBe(0);
    expect(backdate.output).toContain("UPDATE 1");
  });
  await page.reload();
  await expect(row(page, "FIIs")).toBeVisible();
  await check("The FIIs row's own \"Desatualizados\" count picks it up, not just the overall badge", async () => {
    await expect(async () => {
      const after = await row(page, "FIIs").getByRole("cell").allTextContents();
      expect(Number(after[4])).toBe(Number(before[4]) + 1);
    }).toPass();
  });

  await scene("The backfill script links a holding to a real Asset", "pnpm exec tsx scripts/backfill-asset-links.ts — dry run, then for real");
  await say("Dry run first: it reports the plan without writing anything");
  // Dev mode logs every Prisma query to stdout; filtered out here so the page shows the script's own report, not a wall of SQL.
  const dryRun = await terminal("bash", ["-c", `set -o pipefail; pnpm exec tsx scripts/backfill-asset-links.ts --dry-run | grep -v '^prisma:'`]);
  await check("The dry run names what it would link, and nothing is written", async () => {
    expect(dryRun.code).toBe(0);
    expect(dryRun.output).toMatch(new RegExp(`would link .*\\(${LINKABLE}\\)`));
    expect(dryRun.output).toContain("dry run, nothing written");
  });

  await say("For real: it creates the Asset (and its brapi/Yahoo source refs) and links the holding");
  const run = await terminal("bash", ["-c", `set -o pipefail; pnpm exec tsx scripts/backfill-asset-links.ts | grep -v '^prisma:'`]);
  await check("It reports linking for real this time", async () => {
    expect(run.code).toBe(0);
    expect(run.output).toMatch(new RegExp(`linked .*\\(${LINKABLE}\\) -> asset`));
    expect(run.output).not.toContain("dry run");
  });

  const linked = await terminal("sh", ["-c", `psql "$DATABASE_URL" -t -A -F'|' -c "SELECT \\"assetId\\" IS NOT NULL, \\"priceSource\\" FROM investment_holdings WHERE ticker = '${LINKABLE}';"`]);
  const unlinked = await terminal("sh", ["-c", `psql "$DATABASE_URL" -t -A -c "SELECT \\"assetId\\" FROM investment_holdings WHERE ticker = '${UNLINKABLE}';"`]);
  await check(`${LINKABLE} (a stock) is linked, auto-priced; ${UNLINKABLE} (fixed income) stays manual — there's still no automatic source for it`, async () => {
    expect(linked.output.trim()).toBe("t|auto");
    expect(unlinked.output.trim()).toBe("");
  });

  const refs = await terminal("sh", [
    "-c",
    `psql "$DATABASE_URL" -t -A -F'|' -c "SELECT source, \\"externalId\\" FROM asset_source_refs r JOIN assets a ON a.id = r.\\"assetId\\" WHERE a.symbol = '${LINKABLE}' ORDER BY source;"`,
  ]);
  await check(`${LINKABLE} got both the brapi and the Yahoo ".SA" fallback source refs, in one script run`, async () => {
    expect(refs.output).toContain(`brapi|${LINKABLE}`);
    expect(refs.output).toContain(`yahoo|${LINKABLE}.SA`);
  });

  // IntegrationRun has no per-test namespace (same reason market-data-crons.test.ts
  // cleans it up in afterEach): 33-market-data-health.flow.ts expects a database with
  // no cron run at all yet, and the two flows don't run in any guaranteed order.
  const cleanup = await terminal("sh", [
    "-c",
    `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM integration_runs WHERE job = ANY(ARRAY['sync-prices','update-prices','update-rates','benchmarks','pluggy-sync']);"`,
  ]);
  await check("Tidy up: the jobs marked ok for this flow don't leak into another flow's own run", async () => {
    expect(cleanup.code).toBe(0);
  });
});
