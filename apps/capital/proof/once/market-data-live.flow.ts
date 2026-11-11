import { expect, flow } from "@repo/proof-video";

/**
 * F1.1, against the real quote APIs (no mocks, no database): how the B3
 * chain behaves without a BRAPI_TOKEN. brapi.dev answers its free demo
 * tickers and refuses every other with 401. Before F1.1 that 401 was
 * retried three times and read as "provider down"; now it is "unauthorized"
 * after one request, and the registry puts Yahoo first for B3 when there is
 * no token.
 *
 * Yahoo itself may not be reachable from where this is recorded (the cloud
 * sandbox's proxy refuses its hosts): the probe prints whatever it answered
 * and the checks below do not depend on it. The fall-through to Yahoo is
 * covered by registry.test.ts and sync-prices.test.ts.
 */

flow("Live B3 chain without a BRAPI_TOKEN: Yahoo leads, brapi's 401 is one request and 'unauthorized'", async ({ scene, say, check, terminal }) => {
  await scene("The real providers, asked for two B3 tickers", "ITUB4 is one of brapi's free demo tickers, WEGE3 is not");
  await say("Each provider in the chain is asked directly, and the HTTP requests it took are counted");
  const probe = await terminal(
    "bash",
    ["-c", "set -o pipefail; pnpm exec tsx proof/once/market-data-live.probe.ts 2>&1 | grep -E '^(BRAPI_TOKEN|ITUB4|WEGE3|\\[http\\])'"],
    { env: { BRAPI_TOKEN: "", NODE_USE_ENV_PROXY: "1", DATABASE_URL: "postgresql://probe@127.0.0.1/none" }, timeoutMs: 120_000 },
  );

  await check("With no token, the B3 chain is Yahoo first and brapi as the fallback", async () => {
    expect(probe.code).toBe(0);
    expect(probe.output).toContain("BRAPI_TOKEN unset -> B3 chain: yahoo -> brapi -> coingecko");
  });
  await check("brapi prices ITUB4 for real, in one request, as a close", async () => {
    expect(probe.output).toMatch(/ITUB4 brapi ok \d{4}-\d{2}-\d{2} BRL \d+(\.\d+)? kind=(close|intraday) requests=1/);
  });
  await check("brapi refuses WEGE3 with a 401 after exactly one request: 'unauthorized', not three retries and 'provider down'", async () => {
    expect(probe.output).toContain("WEGE3 brapi unauthorized status=401 requests=1");
    expect(probe.output).toMatch(/\[http\] brapi\.dev WEGE3: refused \(HTTP 401\)/);
    expect(probe.output).not.toMatch(/WEGE3: attempt \d\/3 failed/);
  });
});
