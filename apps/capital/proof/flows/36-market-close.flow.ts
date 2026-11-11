import { expect, flow } from "@repo/proof-video";
import { proofEnv } from "../env";

/**
 * F1.1: the daily market-close pipeline. One cron call at 22:30 UTC runs
 * sync-prices → update-prices → portfolio-snapshot in order, each recorded
 * as its own IntegrationRun, instead of three clock times 30 minutes apart.
 * Every cron answers 401 without the shared secret, and records its run.
 * The rest of F1.1 (session calendar, same-day suspect prices, brapi's 401,
 * currency-mismatched links, relinking on edit) has nothing to click: its
 * tests run on camera at the end.
 *
 * The proof server reads CRON_SECRET from apps/capital/.env, as production
 * reads it from .env.production. Commands pull it into their own shell and
 * never print it; the recorder masks every .env value as well.
 */

// The pipeline calls the live quote sources and the tests take a while: more than the default time limit.
flow.setTimeout(420_000);

const BASE = proofEnv().baseURL;
const SECRET = `$(node -e 'process.stdout.write(require("node:util").parseEnv(require("node:fs").readFileSync(".env","utf8")).CRON_SECRET ?? "")')`;
const cron = (path: string, auth: boolean) =>
  `curl -s -w '\\nHTTP %{http_code}\\n' ${auth ? `-H "Authorization: Bearer ${SECRET}" ` : ""}${BASE}/api/cron/${path}`;

const STAGES = ["sync-prices", "update-prices", "portfolio-snapshot"];

const F1_1_TESTS = [
  "src/server/modules/market-data/lib/__tests__/calendar.test.ts",
  "src/server/modules/market-data/lib/__tests__/registry.test.ts",
  "src/server/lib/__tests__/http.test.ts",
  "src/server/modules/market-data/services/__tests__/sync-prices.test.ts",
  "src/server/modules/market-data/services/__tests__/resolve-asset.test.ts",
  "src/server/modules/investments/services/__tests__/update-prices.test.ts",
  "src/server/modules/health/routes/__tests__/market-data.test.ts",
  "src/app/api/cron/__tests__/market-data-crons.test.ts",
  "src/app/api/cron/__tests__/portfolio-crons.test.ts",
];

flow("Market close: one cron call runs the three stages in order, every cron needs the secret, and the F1.1 tests pass", async ({ scene, say, check, terminal }) => {
  const startedAt = new Date().toISOString();

  await scene("One schedule entry instead of three", "infrastructure/cronjobs/schedules/capital.json");
  const schedule = await terminal("sh", ["-c", "grep -n 'cron/' ../../infrastructure/cronjobs/schedules/capital.json"]);
  await check("market-close runs at 22:30 UTC, after the B3 and New York closes; sync-prices, update-prices and portfolio-snapshot are no longer scheduled on their own", async () => {
    expect(schedule.output).toMatch(/"\/api\/cron\/market-close", "schedule": "30 22 \* \* \*"/);
    for (const stage of STAGES) expect(schedule.output).not.toContain(`/api/cron/${stage}"`);
  });

  await scene("Without the secret, nothing runs", "Every cron route answers 401 to a call without CRON_SECRET");
  const open = await terminal("sh", ["-c", ["market-close", "notify", "portfolio-snapshot", "fire-snapshot"].map((path) => `echo ${path}; ${cron(path, false)}`).join("; ")]);
  await check("market-close, notify, portfolio-snapshot and fire-snapshot all answer 401", async () => {
    expect(open.output.match(/HTTP 401/g)).toHaveLength(4);
  });

  await scene("With the secret, one call runs the pipeline", "sync-prices → update-prices → portfolio-snapshot, each recorded as its own run");
  await say("The live quote sources answer whatever they answer from here: what matters is that every stage runs, in order, even after one fails");
  const run = await terminal("sh", ["-c", cron("market-close", true)], { timeoutMs: 180_000 });
  const body = JSON.parse(run.output.slice(0, run.output.lastIndexOf("\nHTTP"))) as { stages: { job: string; status: string }[] };
  await check("The response lists the three stages, in order", async () => {
    expect(body.stages.map((s) => s.job)).toEqual(STAGES);
  });

  const runs = await terminal("sh", [
    "-c",
    `psql "$DATABASE_URL" -t -A -F'|' -c "SELECT job, trigger, status FROM integration_runs WHERE \\"startedAt\\" >= '${startedAt}' ORDER BY \\"startedAt\\";"`,
  ]);
  await check("integration_runs has one row per stage, in that order, all with trigger cron", async () => {
    const rows = runs.output.trim().split("\n").map((line) => line.split("|"));
    expect(rows.map((r) => r[0])).toEqual(STAGES);
    expect(rows.every((r) => r[1] === "cron")).toBe(true);
  });

  await scene("notify now leaves a run on record too", "The Saúde dos dados panel and Uptime Kuma read IntegrationRun");
  const notify = await terminal("sh", [
    "-c",
    `${cron("notify", true)}; psql "$DATABASE_URL" -t -A -c "SELECT job || ' ' || status FROM integration_runs WHERE job = 'notify' AND \\"startedAt\\" >= '${startedAt}';"`,
  ]);
  await check("A notify call with the secret is recorded as an IntegrationRun", async () => {
    expect(notify.output).toMatch(/^notify (ok|skipped|partial|failed)$/m);
  });

  await scene("Everything else F1.1 changed runs in its tests", "Session calendar, same-day suspect prices, brapi's 401, currency mismatch, relink on edit, the pipeline itself");
  const tests = await terminal("pnpm", ["exec", "vitest", "run", ...F1_1_TESTS], { timeoutMs: 240_000 });
  await check("Every one of those test files passes", async () => {
    expect(tests.code).toBe(0);
    expect(tests.output).toMatch(new RegExp(`Test Files\\s+${F1_1_TESTS.length} passed`));
    expect(tests.output).not.toMatch(/\d+ failed/);
  });

  // 33-market-data-health.flow.ts expects a database where no cron has run yet.
  const cleanup = await terminal("sh", ["-c", `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM integration_runs WHERE \\"startedAt\\" >= '${startedAt}';"`]);
  await check("Tidy up: this flow's runs don't leak into another flow", async () => {
    expect(cleanup.code).toBe(0);
  });
});
