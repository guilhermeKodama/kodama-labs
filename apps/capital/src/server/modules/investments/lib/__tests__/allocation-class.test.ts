import { describe, expect, it } from "vitest";
import { ASSET_CLASSES, allocationClassOf, dominantEtfCurrency, holdingAllocationClass, toAllocationTargets } from "../allocation-class";

describe("allocationClassOf", () => {
  it("maps every asset class onto one of the six", () => {
    expect(Object.fromEntries(ASSET_CLASSES.map((c) => [c, allocationClassOf(c, "BRL")]))).toEqual({
      stocks: "br_stocks",
      fii: "fii",
      etf: "br_stocks",
      bdr: "international",
      fixed_income: "fixed_income",
      crypto: "crypto",
      savings: "fixed_income",
      international_stocks: "international",
      international_etf: "international",
    });
  });

  it("splits ETFs by currency, taking a currency-less ETF as Brazilian", () => {
    expect(allocationClassOf("etf", "USD")).toBe("international");
    expect(allocationClassOf("etf", "brl")).toBe("br_stocks");
    expect(allocationClassOf("etf")).toBe("br_stocks");
    // BDRs trade in BRL but are foreign companies.
    expect(allocationClassOf("bdr", "BRL")).toBe("international");
  });

  it("lets the holding override win", () => {
    expect(holdingAllocationClass({ assetClass: "savings", currency: "BRL", allocationClass: "cash" })).toBe("cash");
    expect(holdingAllocationClass({ assetClass: "etf", currency: "USD", allocationClass: null })).toBe("international");
  });
});

describe("toAllocationTargets", () => {
  it("sums targets that collapse into the same class and keeps allocation-class targets", () => {
    const out = toAllocationTargets([
      { assetClass: "fixed_income", targetPercent: 30 },
      { assetClass: "savings", targetPercent: 10 },
      { assetClass: "international_etf", targetPercent: 5 },
      { assetClass: "bdr", targetPercent: 5 },
      { allocationClass: "international", targetPercent: 10 },
      { allocationClass: "cash", targetPercent: 40 },
    ]);
    expect(Object.fromEntries(out.map((t) => [t.allocationClass, t.targetPercent]))).toEqual({ fixed_income: 40, international: 20, cash: 40 });
  });

  it("sends an etf target where the user's ETF money is", () => {
    expect(toAllocationTargets([{ assetClass: "etf", targetPercent: 100 }], "USD")).toEqual([{ allocationClass: "international", targetPercent: 100 }]);
    expect(toAllocationTargets([{ assetClass: "etf", targetPercent: 100 }], "BRL")).toEqual([{ allocationClass: "br_stocks", targetPercent: 100 }]);
    expect(toAllocationTargets([{ assetClass: "etf", targetPercent: 100 }])).toEqual([{ allocationClass: "br_stocks", targetPercent: 100 }]);
  });
});

describe("dominantEtfCurrency", () => {
  it("follows the invested money, then the number of holdings, defaulting to BRL", () => {
    expect(dominantEtfCurrency([])).toBe("BRL");
    expect(
      dominantEtfCurrency([
        { assetClass: "etf", currency: "BRL", totalInvested: 1000 },
        { assetClass: "etf", currency: "USD", totalInvested: 100 },
        { assetClass: "stocks", currency: "USD", totalInvested: 5000 },
      ])
    ).toBe("BRL");
    expect(
      dominantEtfCurrency([
        { assetClass: "etf", currency: "USD", totalInvested: 0 },
        { assetClass: "etf", currency: "USD", totalInvested: 0 },
        { assetClass: "etf", currency: "BRL", totalInvested: 0 },
      ])
    ).toBe("USD");
  });
});
