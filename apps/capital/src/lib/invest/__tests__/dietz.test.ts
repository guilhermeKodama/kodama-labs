import { describe, expect, it } from "vitest";
import { chainLink, compoundPercent, inflationPlus, modifiedDietz, trailingReturn, type MonthValue } from "../dietz";

describe("modifiedDietz", () => {
  it("is the plain return without flows", () => {
    expect(modifiedDietz({ startValue: 1000, endValue: 1100, netFlow: 0 })).toBeCloseTo(0.1, 12);
  });

  it("takes the contribution out of the gain and counts half of it as invested", () => {
    // 1000 + 500 deposited mid-month, ends at 1560: 60 of gain on 1250 of average capital.
    expect(modifiedDietz({ startValue: 1000, endValue: 1560, netFlow: 500 })).toBeCloseTo(60 / 1250, 12);
  });

  it("handles a withdrawal", () => {
    // 1000 − 200 taken out, ends at 820: 20 of gain on 900.
    expect(modifiedDietz({ startValue: 1000, endValue: 820, netFlow: -200 })).toBeCloseTo(20 / 900, 12);
  });

  it("measures a first month that starts from zero on the deposit", () => {
    expect(modifiedDietz({ startValue: 0, endValue: 1010, netFlow: 1000 })).toBeCloseTo(10 / 500, 12);
  });

  it("has no return without a capital base", () => {
    expect(modifiedDietz({ startValue: 0, endValue: 0, netFlow: 0 })).toBeNull();
    expect(modifiedDietz({ startValue: 100, endValue: 0, netFlow: -300 })).toBeNull();
  });
});

describe("chainLink and benchmarks", () => {
  it("compounds monthly returns", () => {
    expect(chainLink([0.1, -0.1])).toBeCloseTo(-0.01, 12);
    expect(chainLink([])).toBe(0);
  });

  it("compounds BCB percent rates", () => {
    // 12 months of 1% = 12.68%.
    expect(compoundPercent(Array(12).fill(1))).toBeCloseTo(1.01 ** 12 - 1, 12);
  });

  it("adds a real rate on top of inflation", () => {
    expect(inflationPlus(0.05, 0.06)).toBeCloseTo(0.113, 12);
  });
});

describe("trailingReturn", () => {
  const month = (i: number) => `2025-${String(i + 1).padStart(2, "0")}`;

  it("chains the last 12 months, using the month before the window as the start value", () => {
    // 13 months growing 1% a month with no flows.
    const series: MonthValue[] = Array.from({ length: 14 }, (_, i) => ({ period: i < 12 ? month(i) : `2026-0${i - 11}`, value: 1000 * 1.01 ** i, netFlow: 0 }));
    const r = trailingReturn(series);
    expect(r.months).toBe(12);
    expect(r.value).toBeCloseTo(1.01 ** 12 - 1, 10);
    expect(r.from).toBe("2025-03");
    expect(r.to).toBe("2026-02");
    expect(r.monthly).toHaveLength(12);
  });

  it("is not moved by contributions", () => {
    const series: MonthValue[] = [
      { period: "2026-01", value: 1000, netFlow: 0 },
      // +1000 deposited, value grows 2% on the start value and 1% on the deposit.
      { period: "2026-02", value: 1000 * 1.02 + 1000 * 1.01, netFlow: 1000 },
    ];
    const r = trailingReturn(series);
    expect(r.value).toBeCloseTo(30 / 1500, 10);
  });

  it("leaves out months whose start or end value is an estimate", () => {
    const series: MonthValue[] = [
      { period: "2026-01", value: 1000, netFlow: 0, estimated: true },
      { period: "2026-02", value: 1500, netFlow: 0, estimated: true },
      { period: "2026-03", value: 1600, netFlow: 0 },
      { period: "2026-04", value: 1680, netFlow: 0 },
    ];
    const r = trailingReturn(series);
    expect(r.monthly.map((m) => m.return === null)).toEqual([true, true, false]);
    expect(r.value).toBeCloseTo(0.05, 10);
    expect(r).toMatchObject({ months: 1, from: "2026-04", to: "2026-04" });
    // Without skipping, the jump from the estimates is a return.
    expect(trailingReturn(series, { skipEstimated: false }).months).toBe(3);
  });

  it("is null when nothing can be measured", () => {
    expect(trailingReturn([{ period: "2026-01", value: 10, netFlow: 0 }])).toMatchObject({ value: null, months: 0, from: null });
    expect(trailingReturn([])).toMatchObject({ value: null, months: 0 });
  });
});
