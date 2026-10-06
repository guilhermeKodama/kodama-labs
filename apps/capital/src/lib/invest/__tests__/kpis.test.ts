import { describe, expect, it } from "vitest";
import { trailingReturn } from "../dietz";
import { return12mState, savingsRateKpi } from "../kpis";

describe("savingsRateKpi", () => {
  it("caps Taxa de poupança at 100% and says so when aportes exceed the PF income", () => {
    expect(savingsRateKpi(963.12)).toEqual({ value: 1, capped: true });
    expect(savingsRateKpi(1.0001)).toEqual({ value: 1, capped: true });
    expect(savingsRateKpi(1)).toEqual({ value: 1, capped: false });
    expect(savingsRateKpi(0.38)).toEqual({ value: 0.38, capped: false });
    expect(savingsRateKpi(null)).toEqual({ value: null, capped: false });
    expect(savingsRateKpi(undefined)).toEqual({ value: null, capped: false });
  });
});

describe("return12mState", () => {
  it("tells an all-estimated window ('histórico estimado') from one with no closed month yet", () => {
    expect(return12mState({ value: 0.148, estimated: false })).toBe("value");
    expect(return12mState({ value: 0, estimated: false })).toBe("value");
    expect(return12mState({ value: null, estimated: true })).toBe("estimated");
    expect(return12mState({ value: null, estimated: false })).toBe("pending");
    expect(return12mState(undefined)).toBe("pending");
  });

  it("follows trailingReturn's count of months left out as estimates", () => {
    const series = [
      { period: "2026-07", value: 100, netFlow: 0, estimated: true },
      { period: "2026-08", value: 110, netFlow: 0, estimated: true },
      { period: "2026-09", value: 120, netFlow: 0 },
    ];
    expect(trailingReturn(series)).toMatchObject({ value: null, months: 0, estimatedMonths: 2 });
    expect(trailingReturn([...series, { period: "2026-10", value: 126, netFlow: 0 }])).toMatchObject({ months: 1, estimatedMonths: 2 });
    expect(trailingReturn([{ period: "2026-09", value: 0, netFlow: 0 }, { period: "2026-10", value: 0, netFlow: 0 }])).toMatchObject({ value: null, estimatedMonths: 0 });
  });
});
