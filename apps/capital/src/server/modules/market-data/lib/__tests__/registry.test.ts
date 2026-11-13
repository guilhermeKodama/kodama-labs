import { afterEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ MARKET_DATA_CHAIN: undefined as string | undefined, MARKET_DATA_DISABLED: undefined as string | undefined, BRAPI_TOKEN: undefined as string | undefined }));
vi.mock("@/env", () => ({ env: envMock }));

import { activeProviderFor, activeProviders, chainFor } from "../registry";

afterEach(() => {
  envMock.MARKET_DATA_CHAIN = undefined;
  envMock.MARKET_DATA_DISABLED = undefined;
  envMock.BRAPI_TOKEN = undefined;
});

describe("activeProviders", () => {
  it("lists brapi, Alpha Vantage and CoinGecko, whether or not brapi has a token", () => {
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi", "alpha_vantage", "coingecko"]);
    envMock.BRAPI_TOKEN = "  ";
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi", "alpha_vantage", "coingecko"]);
    envMock.BRAPI_TOKEN = "tok";
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi", "alpha_vantage", "coingecko"]);
  });

  it("drops a provider named in MARKET_DATA_DISABLED", () => {
    envMock.MARKET_DATA_DISABLED = "alpha_vantage";
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi", "coingecko"]);
  });

  it("reorders providers named in MARKET_DATA_CHAIN, keeping the rest after", () => {
    envMock.BRAPI_TOKEN = "tok";
    envMock.MARKET_DATA_CHAIN = "alpha_vantage,brapi";
    expect(activeProviders().map((p) => p.id)).toEqual(["alpha_vantage", "brapi", "coingecko"]);
  });

  it("ignores an unknown id in MARKET_DATA_CHAIN instead of failing", () => {
    envMock.MARKET_DATA_CHAIN = "nope,alpha_vantage";
    expect(activeProviders().map((p) => p.id)).toEqual(["alpha_vantage", "brapi", "coingecko"]);
  });

  it("treats a MARKET_DATA_CHAIN or MARKET_DATA_DISABLED made only of separators and blanks as unset", () => {
    envMock.MARKET_DATA_CHAIN = " , ,";
    envMock.MARKET_DATA_DISABLED = ",  ,";
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi", "alpha_vantage", "coingecko"]);
  });

  it("trims the ids of a comma-separated list", () => {
    envMock.MARKET_DATA_DISABLED = " alpha_vantage , coingecko ";
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi"]);
  });

  it("applies MARKET_DATA_DISABLED before MARKET_DATA_CHAIN's reorder", () => {
    envMock.MARKET_DATA_DISABLED = "brapi";
    envMock.MARKET_DATA_CHAIN = "brapi,alpha_vantage,coingecko";
    expect(activeProviders().map((p) => p.id)).toEqual(["alpha_vantage", "coingecko"]);
  });
});

describe("chainFor", () => {
  it("offers only brapi for a B3 class, with or without a token", () => {
    expect(chainFor("stocks").map((p) => p.id)).toEqual(["brapi"]);
    expect(chainFor("fii").map((p) => p.id)).toEqual(["brapi"]);
    envMock.BRAPI_TOKEN = "tok";
    expect(chainFor("stocks").map((p) => p.id)).toEqual(["brapi"]);
  });

  it("offers brapi then Alpha Vantage for etf, and keeps brapi as the active source", () => {
    expect(chainFor("etf").map((p) => p.id)).toEqual(["brapi", "alpha_vantage"]);
    expect(activeProviderFor("etf")?.id).toBe("brapi");
  });

  it("offers only coingecko for crypto", () => {
    expect(chainFor("crypto").map((p) => p.id)).toEqual(["coingecko"]);
  });

  it("offers only Alpha Vantage for international stocks and ETFs", () => {
    expect(chainFor("international_stocks").map((p) => p.id)).toEqual(["alpha_vantage"]);
    expect(chainFor("international_etf").map((p) => p.id)).toEqual(["alpha_vantage"]);
  });

  it("offers nothing for a class with no automatic source", () => {
    expect(chainFor("fixed_income")).toEqual([]);
    expect(chainFor("savings")).toEqual([]);
  });
});

describe("activeProviderFor", () => {
  it("is the chain's first entry", () => {
    envMock.BRAPI_TOKEN = "tok";
    expect(activeProviderFor("stocks")?.id).toBe("brapi");
    expect(activeProviderFor("international_etf")?.id).toBe("alpha_vantage");
    expect(activeProviderFor("fixed_income")).toBeNull();
  });

  it("follows MARKET_DATA_CHAIN for the classes that provider covers", () => {
    envMock.MARKET_DATA_CHAIN = "alpha_vantage";
    expect(activeProviderFor("international_stocks")?.id).toBe("alpha_vantage");
    expect(activeProviderFor("stocks")?.id).toBe("brapi");
  });
});
