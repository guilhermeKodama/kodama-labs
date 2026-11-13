import { describe, expect, it } from "vitest";
import type { MarketDataProvider } from "../provider";

/**
 * The one test every adapter in providers/*.ts runs, so a new source has to
 * prove the same five things a swap might silently break: a known
 * instrument prices, an unknown one is "not found" (not a thrown error), a
 * 429 is "rate limited", a down/5xx transport is "provider down", and a
 * malformed body is "schema changed" — never an uncaught exception, which is
 * the one failure mode withCron can't turn into a clean IntegrationRun.
 *
 * Each `arrange*` puts the test's mocked transport (global fetch, a mocked
 * client, …) into that state for the next call only; what "down" or
 * "malformed" means is the adapter's own test file's business, not this
 * helper's. `arrangeRateLimited` and `arrangeSchemaChanged` are optional:
 * not every provider's transport can produce every outcome — the matching
 * sub-test is skipped,
 * never faked.
 */
export interface ProviderContractFixtures {
  /** An id fetchPrices/the provider's own tests already know resolves once arrangeOk() runs. */
  validExternalId: string;
  /** A query lookup() should return at least one match for once arrangeOk() runs, if the provider has lookup. */
  searchQuery?: string;
  arrangeOk(): void;
  arrangeNotFound(): void;
  arrangeProviderDown(): void;
  arrangeRateLimited?(): void;
  arrangeSchemaChanged?(): void;
}

const RANGE = { from: "2026-01-01", to: "2026-01-01" };

export function describeProviderContract(provider: MarketDataProvider, fixtures: ProviderContractFixtures): void {
  describe(`${provider.id} provider contract`, () => {
    if (provider.fetchPrices) {
      describe("fetchPrices", () => {
        it("returns ok with at least one point for a known instrument", async () => {
          fixtures.arrangeOk();
          const result = await provider.fetchPrices!(fixtures.validExternalId, RANGE);
          expect(result.outcome).toBe("ok");
          if (result.outcome === "ok") expect(result.data.length).toBeGreaterThan(0);
        });

        it("returns not_found for an unknown instrument, never null or a throw", async () => {
          fixtures.arrangeNotFound();
          const result = await provider.fetchPrices!(fixtures.validExternalId, RANGE);
          expect(result.outcome).toBe("not_found");
        });

        it("returns provider_down on a network or server failure, never throwing", async () => {
          fixtures.arrangeProviderDown();
          const result = await provider.fetchPrices!(fixtures.validExternalId, RANGE);
          expect(result.outcome).toBe("provider_down");
        });

        it.skipIf(!fixtures.arrangeRateLimited)("returns rate_limited on a 429", async () => {
          fixtures.arrangeRateLimited!();
          const result = await provider.fetchPrices!(fixtures.validExternalId, RANGE);
          expect(result.outcome).toBe("rate_limited");
        });

        it.skipIf(!fixtures.arrangeSchemaChanged)("returns schema_changed when the response shape doesn't match", async () => {
          fixtures.arrangeSchemaChanged!();
          const result = await provider.fetchPrices!(fixtures.validExternalId, RANGE);
          expect(result.outcome).toBe("schema_changed");
        });
      });
    }

    if (provider.lookup) {
      describe("lookup", () => {
        it("returns ok with matches for a known query", async () => {
          fixtures.arrangeOk();
          const result = await provider.lookup!(fixtures.searchQuery ?? fixtures.validExternalId);
          expect(result.outcome).toBe("ok");
          if (result.outcome === "ok") expect(result.data.length).toBeGreaterThan(0);
        });

        it("never throws when the transport is down", async () => {
          fixtures.arrangeProviderDown();
          const result = await provider.lookup!(fixtures.searchQuery ?? fixtures.validExternalId);
          expect(result.outcome).not.toBe("ok");
        });
      });
    }
  });
}
