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
  it("puts Yahoo first when brapi has no token, brapi first when it has one", () => {
    expect(activeProviders().map((p) => p.id)).toEqual(["yahoo", "brapi", "coingecko"]);
    envMock.BRAPI_TOKEN = "  ";
    expect(activeProviders().map((p) => p.id)).toEqual(["yahoo", "brapi", "coingecko"]);
    envMock.BRAPI_TOKEN = "tok";
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi", "yahoo", "coingecko"]);
  });

  it("drops a provider named in MARKET_DATA_DISABLED", () => {
    envMock.MARKET_DATA_DISABLED = "yahoo";
    expect(activeProviders().map((p) => p.id)).toEqual(["brapi", "coingecko"]);
  });

  it("reorders providers named in MARKET_DATA_CHAIN, keeping the rest after", () => {
    envMock.BRAPI_TOKEN = "tok";
    envMock.MARKET_DATA_CHAIN = "yahoo,brapi";
    expect(activeProviders().map((p) => p.id)).toEqual(["yahoo", "brapi", "coingecko"]);
  });

  it("ignores an unknown id in MARKET_DATA_CHAIN instead of failing", () => {
    envMock.MARKET_DATA_CHAIN = "nope,yahoo";
    expect(activeProviders().map((p) => p.id)).toEqual(["yahoo", "brapi", "coingecko"]);
  });

  it("applies MARKET_DATA_DISABLED before MARKET_DATA_CHAIN's reorder", () => {
    envMock.MARKET_DATA_DISABLED = "brapi";
    envMock.MARKET_DATA_CHAIN = "brapi,yahoo,coingecko";
    expect(activeProviders().map((p) => p.id)).toEqual(["yahoo", "coingecko"]);
  });
});

describe("chainFor", () => {
  it("offers yahoo then brapi for a B3 class without a brapi token, brapi then yahoo with one", () => {
    expect(chainFor("stocks").map((p) => p.id)).toEqual(["yahoo", "brapi"]);
    envMock.BRAPI_TOKEN = "tok";
    expect(chainFor("stocks").map((p) => p.id)).toEqual(["brapi", "yahoo"]);
  });

  it("offers only coingecko for crypto", () => {
    expect(chainFor("crypto").map((p) => p.id)).toEqual(["coingecko"]);
  });

  it("offers only yahoo for international stocks", () => {
    expect(chainFor("international_stocks").map((p) => p.id)).toEqual(["yahoo"]);
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
    expect(activeProviderFor("fixed_income")).toBeNull();
  });

  it("follows MARKET_DATA_CHAIN", () => {
    envMock.BRAPI_TOKEN = "tok";
    envMock.MARKET_DATA_CHAIN = "yahoo";
    expect(activeProviderFor("stocks")?.id).toBe("yahoo");
  });
});
