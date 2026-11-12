import { describe, expect, it } from "vitest";
import { marketValue } from "../holding-value";

describe("marketValue", () => {
  it("is quantity x price while the position is open and priced", () => {
    expect(marketValue({ assetClass: "stocks", currentQuantity: 10, currentPrice: 38.5, totalInvested: 300 })).toBe(385);
  });

  it("falls back to the cost basis while an open position has no price yet", () => {
    expect(marketValue({ assetClass: "stocks", currentQuantity: 10, currentPrice: null, totalInvested: 300 })).toBe(300);
  });

  it("treats a price of zero as a real price", () => {
    expect(marketValue({ assetClass: "stocks", currentQuantity: 10, currentPrice: 0, totalInvested: 300 })).toBe(0);
  });

  it("is the cost basis for amount-based assets with no quantity, and zero for anything else sold out", () => {
    expect(marketValue({ assetClass: "fixed_income", currentQuantity: 0, currentPrice: null, totalInvested: 1000 })).toBe(1000);
    expect(marketValue({ assetClass: "savings", currentQuantity: 0, currentPrice: 1, totalInvested: 250 })).toBe(250);
    expect(marketValue({ assetClass: "stocks", currentQuantity: 0, currentPrice: 40, totalInvested: 300 })).toBe(0);
    expect(marketValue({ assetClass: "crypto", currentQuantity: 0, currentPrice: null, totalInvested: 300 })).toBe(0);
  });
});
