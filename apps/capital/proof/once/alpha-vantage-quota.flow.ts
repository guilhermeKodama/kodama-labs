import { expect, flow } from "@repo/proof-video";

/**
 * Nothing on screen changes: ETF's fonte ativa stays brapi, and the daily
 * cap is a counter. The proof is the suite that fails without this change.
 */
flow("Alpha Vantage prices a non-B3 ETF and stays inside the daily cap", async ({ scene, say, check, terminal }) => {
  await scene("Quota, freshness and the ETF chain", "Nothing new on screen, so the proof is the commands and their result");
  await say("These tests fail if a non-B3 ETF is left unpriced, if a fresh close is fetched again, or if a 23rd call of the day gets through");
  const tests = await terminal(
    "bash",
    [
      "-c",
      "export NODE_ENV=test; pnpm exec vitest run --reporter=verbose src/server/modules/market-data/lib/__tests__/alpha-vantage-budget.test.ts src/server/modules/market-data/lib/__tests__/registry.test.ts src/server/modules/market-data/services/__tests__/resolve-asset.test.ts src/server/modules/market-data/services/__tests__/sync-prices.test.ts src/server/modules/market-data/services/__tests__/alpha-vantage-migration.test.ts src/server/modules/market-data/providers/__tests__/alpha-vantage.test.ts > /tmp/av-quota-proof.txt; status=$?; grep -E '✓|Test Files|^[[:space:]]+Tests ' /tmp/av-quota-proof.txt | grep -E 'offers brapi then Alpha Vantage for etf|routes a plain .etf. holding|prices an etf whose only ref is Alpha|does not call Alpha Vantage when the expected|still calls Alpha Vantage when the session|treats the real rate-limit notices|converts a GBP LSE quote from pence|allows 22 calls on a UTC day|does not call Alpha Vantage once the day|Test Files|^[[:space:]]+Tests '; exit $status",
    ],
    { timeoutMs: 180_000 },
  );

  await check("A non-B3 ETF is stored as an international ETF, and the ETF chain can still ask Alpha Vantage", async () => {
    expect(tests.code).toBe(0);
    expect(tests.output).toContain("offers brapi then Alpha Vantage for etf, and keeps brapi as the active source");
    expect(tests.output).toContain("routes a plain 'etf' holding by the ticker's own shape");
    expect(tests.output).toContain("prices an etf whose only ref is Alpha Vantage, and does not ask brapi");
  });

  await check("A fresh close is not fetched, an intraday quote is, a premium rate-limit notice stays rate-limited, a London quote in pounds is converted from pence, and the 23rd call of the day is refused", async () => {
    expect(tests.output).toContain("does not call Alpha Vantage when the expected session already has an ok close");
    expect(tests.output).toContain("still calls Alpha Vantage when the session's only ok row is an intraday quote");
    expect(tests.output).toContain("treats the real rate-limit notices as rate_limited, including the ones that mention premium, and does not retry");
    expect(tests.output).toContain("converts a GBP LSE quote from pence and rejects an LSE quote in an unknown currency");
    expect(tests.output).toContain("allows 22 calls on a UTC day and refuses the 23rd, then starts again the next day");
    expect(tests.output).toContain("does not call Alpha Vantage once the day's row is already full");
    expect(tests.output).toMatch(/Test Files\s+6 passed/);
  });
});
