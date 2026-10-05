import { describe, expect, it } from "vitest";
import { currencyName, currencySymbol, signupCurrencies } from "../signup-currencies";

/** loadFx's conversion: units of the base currency per unit of `code`. */
const toBase = (rows: ReturnType<typeof signupCurrencies>, code: string) => 1 / rows.find((r) => r.code === code)!.manualRate;

describe("signupCurrencies", () => {
  it("seeds BRL, USD and EUR relative to a BRL base, named in the user's locale", () => {
    const rows = signupCurrencies("BRL", "pt-BR");
    expect(rows.map((r) => r.code)).toEqual(["BRL", "USD", "EUR"]);
    expect(rows[0]).toEqual({ code: "BRL", name: "Real brasileiro", symbol: "R$", manualRate: 1, source: "ptax" });
    expect(rows[1]).toMatchObject({ name: "Dólar americano", symbol: "US$" });
    // Placeholder rates: the daily FX update owns them, so none is "manual".
    expect(rows.every((r) => r.source === "ptax")).toBe(true);
    expect(toBase(rows, "USD")).toBeCloseTo(5.41, 3);
    expect(toBase(rows, "EUR")).toBeCloseTo(6.02, 3);
  });

  it("derives the rates from any base it knows, and names them in English for en", () => {
    const rows = signupCurrencies("usd", "en");
    expect(rows.map((r) => r.code)).toEqual(["USD", "BRL", "EUR"]);
    expect(rows[0]).toEqual({ code: "USD", name: "US Dollar", symbol: "$", manualRate: 1, source: "ecb" });
    expect(rows[1].manualRate).toBeCloseTo(5.41, 6);
    expect(toBase(rows, "EUR")).toBeCloseTo(6.02 / 5.41, 4);
  });

  it("seeds only the base currency when there is no rate to derive the others from", () => {
    expect(signupCurrencies("CHF", "pt-BR")).toEqual([{ code: "CHF", name: "Franco suíço", symbol: "CHF", manualRate: 1, source: "ecb" }]);
  });

  it("falls back to the code for a code Intl rejects", () => {
    expect(currencyName("1$x", "en")).toBe("1$x");
    expect(currencySymbol("1$x", "en")).toBe("1$x");
  });
});
