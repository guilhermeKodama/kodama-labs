import { expect, flow } from "@repo/proof-video";
import { dialog, valueOf } from "../helpers";
import { proofEnv } from "../env";
import { expectedLatestSession, previousSession, zonedInstant } from "../../src/server/modules/market-data/lib/calendar";

/**
 * F0: a cron that answers 200 but prices or refreshes nothing is no longer
 * invisible, and a holding that cannot be auto-priced (or hasn't been in a
 * while) says so instead of hiding behind a fresher one.
 *
 * F1.1: "stale" is counted in B3 trading sessions, not hours. One missed
 * close is still fresh (the old 30-hour rule flagged it every morning);
 * two or more is stale.
 */

const BASE = proofEnv().baseURL;
// WEGE3 (stocks, XP, PF): priced moments ago by the demo seed. Backdating
// it is the fastest way to show a holding going stale without waiting for
// a real market close.
const STALE_TICKER = "WEGE3";
// LCA (fixed income, XP, PF): no automatic source exists for this class
// yet, so it needs no setup to show "sem fonte automática".
const UNSUPPORTED_TICKER = "LCA";
// Ten calendar days back is always at least two missed B3 sessions, whatever day the flow runs.
const STALE_DAYS = 10;
const B3_TZ = "America/Sao_Paulo";

interface MarketDataHealth {
  status: string;
  jobs: { job: string; status: string; lastRunAt: string | null }[];
  holdings: { total: number; priceable: number; stale: number; staleAfterSessions: number };
}

flow(
  "Market data health: a cron that changed nothing is visible, and a stale or unpriceable holding says so",
  async ({ scene, say, check, terminal, page }) => {
    await scene("The health endpoint, before any cron has ever run here", "A job that answers 200 but prices nothing used to look the same as a healthy one");
    await say("GET /api/health/market-data checks IntegrationRun, the run log, not just whether the route answered");
    const before = await terminal("curl", ["-s", `${BASE}/api/health/market-data`]);
    const beforeBody = JSON.parse(before.output) as MarketDataHealth;
    await check("No cron has run yet in this environment: every job is down, and the endpoint itself answers 503", async () => {
      expect(before.code).toBe(0);
      expect(beforeBody.status).toBe("down");
      for (const job of ["sync-prices", "update-prices", "portfolio-snapshot", "update-rates", "benchmarks", "pluggy-sync"]) {
        expect(beforeBody.jobs.find((j) => j.job === job)).toMatchObject({ status: "down", lastRunAt: null });
      }
    });

    const staleHolding = page.getByRole("button", { name: new RegExp(`^${STALE_TICKER} `) });
    const staleSheet = dialog(page, new RegExp(`^${STALE_TICKER} `));

    await scene("One missed close is not stale", "Freshness is counted in B3 trading sessions, not hours");
    // The opening of the session before the latest close that should be in by now: one close
    // missed, and always more than 30 hours ago (the old limit), whatever time the flow runs.
    const latest = expectedLatestSession("B3");
    const oneBehind = previousSession("B3", latest);
    const oneBehindAt = zonedInstant(B3_TZ, oneBehind, 10, 0);
    const ageHours = Math.floor((Date.now() - oneBehindAt.getTime()) / 3_600_000);
    await say(`${STALE_TICKER}'s quote is set to the ${oneBehind} session, ${ageHours}h ago: the ${latest} close is the only one it missed`);
    const oneSession = await terminal("sh", [
      "-c",
      `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE investment_holdings SET \\"lastPriceUpdate\\" = '${oneBehindAt.toISOString()}' WHERE ticker = '${STALE_TICKER}';"`,
    ]);
    const oneSessionHealth = JSON.parse((await terminal("curl", ["-s", `${BASE}/api/health/market-data`])).output) as MarketDataHealth;
    await check(`A quote ${ageHours}h old (more than the old 30h limit) but only one close behind still counts as fresh`, async () => {
      expect(oneSession.output).toContain("UPDATE 1");
      expect(ageHours).toBeGreaterThan(30);
      expect(oneSessionHealth.holdings.stale).toBe(beforeBody.holdings.stale);
    });

    await say("Carteira agrees: no badge on the header, and the holding's own sheet shows the quote's date with no warning");
    await page.goto("/investments");
    await check("No \"desatualizada\" badge on the Carteira header, though the quote is more than 30 hours old", async () => {
      await expect(page.getByRole("button", { name: "Atualizar cotações" })).toBeVisible();
      await expect(page.getByText(/\d+ desatualizadas?/)).toHaveCount(0);
    });
    await staleHolding.click();
    await check(`${STALE_TICKER}'s sheet shows the quote's date and does not call it "desatualizada"`, async () => {
      await expect(valueOf(staleSheet, "Cotação em")).toContainText(/\d{2}\/\d{2}/);
      await expect(valueOf(staleSheet, "Cotação em")).not.toContainText("desatualizada");
    });
    await staleSheet.getByRole("button", { name: "Fechar" }).click();

    await scene("A stale price no longer hides behind a fresh one", `${STALE_TICKER}'s quote is set back ${STALE_DAYS} days`);
    await say(`${STALE_DAYS} days back is at least two missed B3 closes: that is stale`);
    const backdate = await terminal("sh", [
      "-c",
      `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE investment_holdings SET \\"lastPriceUpdate\\" = now() - interval '${STALE_DAYS} days' WHERE ticker = '${STALE_TICKER}';"`,
    ]);
    await check(`${STALE_TICKER}'s price timestamp moved back`, async () => {
      expect(backdate.code).toBe(0);
      expect(backdate.output).toContain("UPDATE 1");
    });

    const after = await terminal("curl", ["-s", `${BASE}/api/health/market-data`]);
    const afterBody = JSON.parse(after.output) as MarketDataHealth;
    await check("The health endpoint's holdings count picks it up at once, independent of any cron", async () => {
      expect(afterBody.holdings.stale).toBe(beforeBody.holdings.stale + 1);
      expect(afterBody.holdings.staleAfterSessions).toBe(2);
    });

    await say("Carteira shows the same thing: a badge on the header, and a note on the holding itself");
    await page.goto("/investments");
    await check(`A "1 desatualizada" badge appears on the Carteira header`, async () => {
      await expect(page.getByText("1 desatualizada", { exact: true })).toBeVisible();
    });

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
