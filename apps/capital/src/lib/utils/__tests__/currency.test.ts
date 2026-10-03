import { describe, it, expect } from "vitest";
import type { Currency } from "@/types";
import { amountInUserBase, convertToBaseCurrency } from "../currency";

const usd: Currency = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  manualRate: 0.2,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("amountInUserBase", () => {
  it("divides by manualRate, matching convertToBaseCurrency", () => {
    expect(convertToBaseCurrency(20, "USD", [usd], "BRL")).toBe(100);
    expect(
      amountInUserBase({
        amount: 20,
        currency: "USD",
        currencies: [usd],
        baseCurrency: "BRL",
      })
    ).toBe(100);
  });

  it("leaves the base currency unchanged", () => {
    expect(
      amountInUserBase({
        amount: 80,
        currency: "BRL",
        currencies: [usd],
        baseCurrency: "BRL",
      })
    ).toBe(80);
  });

  it("lets a stored exchangeRate win over today's manualRate", () => {
    expect(
      amountInUserBase({
        amount: 1000,
        currency: "USD",
        exchangeRate: 5.5,
        currencies: [usd],
        baseCurrency: "BRL",
      })
    ).toBe(5500);
  });
});
