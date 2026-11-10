import { expect, flow } from "@repo/proof-video";
import { dialog, valueOf } from "../helpers";
import { proofEnv } from "../env";

/**
 * F0: a cron that answers 200 but prices or refreshes nothing is no longer
 * invisible, and a holding that cannot be auto-priced (or hasn't been in a
 * while) says so instead of hiding behind a fresher one.
 */

const BASE = proofEnv().baseURL;
// WEGE3 (stocks, XP, PF): priced moments ago by the demo seed. Backdating
// it is the fastest way to show a holding going stale without waiting for
// a real market close.
const STALE_TICKER = "WEGE3";
// LCA (fixed income, XP, PF): no automatic source exists for this class
// yet, so it needs no setup to show "sem fonte automática".
const UNSUPPORTED_TICKER = "LCA";
const STALE_HOURS = 50;

interface MarketDataHealth {
  status: string;
  jobs: { job: string; status: string; lastRunAt: string | null }[];
  holdings: { total: number; priceable: number; stale: number };
}

flow(
  "Market data health: a cron that changed nothing is visible, and a stale or unpriceable holding says so",
  async ({ scene, say, check, terminal, page }) => {
    await scene("The health endpoint, before any cron has ever run here", "A job that answers 200 but prices nothing used to look the same as a healthy one");
    await say("GET /api/health/market-data checks IntegrationRun, the run log, not just whether the route answered");
    const before = await terminal("curl", ["-s", `${BASE}/api/health/market-data`]);
    const beforeBody = JSON.parse(before.output) as MarketDataHealth;
    await check("No cron has run yet in this environment: every job is down, and the endpoint itself answers 503", () => {
      expect(before.code).toBe(0);
      expect(beforeBody.status).toBe("down");
      for (const job of ["update-prices", "update-rates", "benchmarks", "pluggy-sync"]) {
        expect(beforeBody.jobs.find((j) => j.job === job)).toMatchObject({ status: "down", lastRunAt: null });
      }
    });

    await scene("A stale price no longer hides behind a fresh one", `${STALE_TICKER}'s quote is set back ${STALE_HOURS}h`);
    await say(`${STALE_TICKER} was priced moments ago by the demo seed; setting its quote back ${STALE_HOURS}h is the fastest way to show one going stale`);
    const backdate = await terminal("sh", [
      "-c",
      `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE investment_holdings SET \\"lastPriceUpdate\\" = now() - interval '${STALE_HOURS} hours' WHERE ticker = '${STALE_TICKER}';"`,
    ]);
    await check(`${STALE_TICKER}'s price timestamp moved back`, () => {
      expect(backdate.code).toBe(0);
      expect(backdate.output).toContain("UPDATE 1");
    });

    const after = await terminal("curl", ["-s", `${BASE}/api/health/market-data`]);
    const afterBody = JSON.parse(after.output) as MarketDataHealth;
    await check("The health endpoint's holdings count picks it up at once, independent of any cron", () => {
      expect(afterBody.holdings.stale).toBe(beforeBody.holdings.stale + 1);
    });

    await say("Carteira shows the same thing: a badge on the header, and a note on the holding itself");
    await page.goto("/investments");
    await check(`A "1 desatualizada" badge appears on the Carteira header`, async () => {
      await expect(page.getByText("1 desatualizada", { exact: true })).toBeVisible();
    });

    const staleHolding = page.getByRole("button", { name: new RegExp(`^${STALE_TICKER} `) });
    const staleSheet = dialog(page, new RegExp(`^${STALE_TICKER} `));
    await staleHolding.click();
    await check(`${STALE_TICKER}'s sheet names the quote "desatualizada"`, async () => {
      await expect(valueOf(staleSheet, "Cotação em")).toContainText("desatualizada");
    });
    await staleSheet.getByRole("button", { name: "Fechar" }).click();

    await scene("Fixed income says plainly it has no automatic source yet", `${UNSUPPORTED_TICKER} is never auto-quoted`);
    await say(`${UNSUPPORTED_TICKER} (renda fixa) had a price already, same as before this change — but its class has no automatic source, so the sheet now says so instead of letting it pass as fresh`);
    const otherHolding = page.getByRole("button", { name: new RegExp(`^${UNSUPPORTED_TICKER} `) });
    const otherSheet = dialog(page, new RegExp(`^${UNSUPPORTED_TICKER} `));
    await otherHolding.click();
    await check(`${UNSUPPORTED_TICKER}'s sheet names the quote "sem fonte automática"`, async () => {
      await expect(valueOf(otherSheet, "Cotação em")).toContainText("sem fonte automática");
    });
  },
);
