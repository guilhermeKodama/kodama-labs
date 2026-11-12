import { describe, expect, it } from "vitest";
import {
  incomeBaseValue,
  incomeTypeKey,
  originKey,
  passiveIncomeBars,
  unmatchedPassiveIncome,
  type PassiveBarInput,
  type PassiveLedgerRef,
  type PassiveOperationRef,
} from "../passive-income";

const day = Date.parse("2026-08-05T12:00:00Z");

describe("stored rate", () => {
  it("uses the cash leg's base amount and falls back to today's rate only when none was stored", () => {
    expect(incomeBaseValue({ totalAmount: 10, currency: "USD", amountBase: 51.29 }, "net", () => 5)).toBe(51.29);
    expect(incomeBaseValue({ totalAmount: 12, taxWithheld: 2, currency: "USD", grossBase: 61.55, amountBase: 51.29 }, "gross", () => 5)).toBe(61.55);
    expect(incomeBaseValue({ totalAmount: 10, currency: "USD" }, "net", () => 5)).toBe(50);
  });
});

describe("unmatched passive income", () => {
  const op: PassiveOperationRef = { id: "op", at: day, netBase: 1122.88, grossBase: 1321.04, cashEntryId: "leg" };

  it("drops the operation's cash leg, one matching income, and a transfer of the same amount", () => {
    const entries: PassiveLedgerRef[] = [
      { id: "leg", at: day, base: 1122.88, transfer: false },
      { id: "income", at: day + 86_400_000, base: 1122.88, transfer: false },
      { id: "xfer", at: day, base: 1122.88, transfer: true },
      { id: "zero", at: day, base: 0, transfer: false },
    ];
    expect(unmatchedPassiveIncome([op], entries)).toEqual([]);
  });

  it("keeps income that is a different amount, and never returns a transfer", () => {
    const entries: PassiveLedgerRef[] = [
      { id: "other", at: day, base: 40, transfer: false },
      { id: "xfer", at: day, base: 40, transfer: true },
    ];
    expect(unmatchedPassiveIncome([op], entries)).toEqual(["other"]);
  });
});

describe("monthly bars", () => {
  const rateFor = (currency: string | null) => (currency === "USD" ? 5 : 1);
  const opts = { from: "2026-08-01", to: "2026-09-30", basis: "net" as const, rateFor };

  it("stacks a month by origin and leaves business-entity interest out", () => {
    const events: PassiveBarInput[] = [
      { date: "2026-08-05", holdingId: "fii", ticker: "MXRF11", assetClass: "fii", incomeType: "fii_income", totalAmount: 100, amountBase: 100 },
      { date: "2026-08-05", holdingId: "bdr", ticker: "AAPL34", assetClass: "bdr", incomeType: "dividend", dividendOrigin: "BDR", totalAmount: 200, currency: "USD", amountBase: 1122.88 },
      { date: "2026-08-20", holdingId: null, totalAmount: 40, amountBase: 40 },
      { date: "2026-08-20", holdingId: "caixa", assetClass: "fixed_income", incomeType: "fixed_income_interest", entityKind: "personal", totalAmount: 30, amountBase: 30 },
      { date: "2026-08-20", holdingId: "pj", assetClass: "fixed_income", incomeType: "fixed_income_interest", entityKind: "business", totalAmount: 999, amountBase: 999 },
    ];
    const bars = passiveIncomeBars(events, { ...opts, series: "origin" });
    expect(bars.months).toEqual(["2026-08", "2026-09"]);
    expect(bars.rows[1]).toMatchObject({ total: 0, values: {} });
    expect(bars.rows[0].values).toMatchObject({ "fii:MXRF11": 100, bdr: 1122.88, unlinked: 40, fixed_income: 30 });
    expect(bars.rows[0].total).toBeCloseTo(1292.88, 2);
    expect(bars.total).toBeCloseTo(1292.88, 2);
    expect(JSON.stringify(bars)).not.toContain("999");
    expect(bars.series[0]).toBe("fii:MXRF11");
  });

  it("groups by income type and reports the tax withheld", () => {
    const events: PassiveBarInput[] = [
      { date: "2026-09-10", holdingId: "h", ticker: "PETR4", assetClass: "stocks", incomeType: "jcp", totalAmount: 100, taxWithheld: 15, amountBase: 85, grossBase: 100, taxBase: 15 },
      { date: "2026-09-10", holdingId: "h2", ticker: "MXRF11", assetClass: "fii", incomeType: "fii_income", totalAmount: 50, amountBase: 50, taxBase: 0 },
    ];
    const net = passiveIncomeBars(events, { ...opts, from: "2026-09-01", to: "2026-09-30", series: "incomeType" });
    expect(net.rows[0].values).toEqual({ fii_income: 50, jcp: 85 });
    expect(net.rows[0].tax).toBe(15);
    const gross = passiveIncomeBars(events, { ...opts, from: "2026-09-01", to: "2026-09-30", series: "incomeType", basis: "gross" });
    expect(gross.rows[0].values.jcp).toBe(100);
    expect(incomeTypeKey({ holdingId: null })).toBe("unlinked");
    expect(originKey({ holdingId: "h", ticker: "KNRI11", assetClass: "fii", incomeType: "fii_income" })).toBe("fii:KNRI11");
  });
});
