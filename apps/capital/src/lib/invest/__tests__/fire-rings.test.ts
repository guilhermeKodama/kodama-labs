import { describe, expect, it } from "vitest";
import {
  arcPath,
  arrivalRange,
  buildTrunk,
  coreX,
  milestoneMarks,
  projectedRings,
  ringCenter,
  ringHistory,
  ringRadius,
  TRUNK,
  UNREACHABLE_YEARS,
  whatIfArrival,
  yearFraction,
  type HistoryPoint,
  type ProjectionPoint,
} from "@/lib/invest/fire-rings";

const NOW = new Date(2026, 9, 20); // 20 Oct 2026

const month = (period: string, netWorth: number, contributed: number, estimated = false): HistoryPoint => ({ period, netWorth, contributed, estimated });

describe("trunk geometry", () => {
  it("makes the area proportional to the value", () => {
    expect(ringRadius(25, 100)).toBe(130);
    expect(ringRadius(100, 100)).toBe(TRUNK.radius);
    expect(ringRadius(0, 100)).toBe(0);
    expect(ringRadius(-5, 100)).toBe(0);
    expect(ringRadius(10, 0)).toBe(0);
  });

  it("moves smaller rings down and to the left, like the logo", () => {
    expect(ringCenter(260)).toEqual({ cx: 300, cy: 300 });
    expect(ringCenter(130)).toEqual({ cx: 291, cy: 307 });
    expect(ringCenter(0)).toEqual({ cx: 282, cy: 314 });
    expect(coreX(260, 300)).toBe(560);
    expect(coreX(130, 307)).toBe(421);
  });

  it("draws the year in progress clockwise from twelve o'clock", () => {
    expect(arcPath(130, 260, 0.25)).toBe("M300 40 A260 260 0 0 1 560 300 L421 307 A130 130 0 0 0 291 177 Z");
    expect(arcPath(130, 260, 0.75)).toContain(" 0 1 1 ");
  });

  it("knows how much of the year has gone", () => {
    expect(yearFraction(NOW)).toBeCloseTo((9 + 20 / 31) / 12, 10);
    expect(yearFraction(new Date(2026, 11, 31))).toBe(1);
  });
});

describe("ringHistory", () => {
  const months = [
    month("2023-10", 0, 0),
    month("2023-11", 10_000, 10_000),
    month("2023-12", 11_000, 10_500),
    month("2024-06", 9_500, 11_000, true),
    month("2024-12", 9_000, 11_500),
    month("2025-12", 12_000, 12_500),
    month("2026-09", 13_000, 13_000),
    month("2026-10", 13_500, 13_500),
  ];

  it("makes the first year with money the core, as it closed, and one ring of each year after it", () => {
    const h = ringHistory(months, 14_000, NOW);
    expect(h.core).toEqual({ year: 2023, month: 11, value: 11_000 });
    expect(h.past).toEqual([
      { year: 2024, value: 9_000, aportes: 1_000, rendimento: -3_000, estimated: true },
      { year: 2025, value: 12_000, aportes: 1_000, rendimento: 2_000, estimated: false },
    ]);
  });

  it("ends the ring in progress at today's FIRE base", () => {
    const h = ringHistory(months, 14_000, NOW);
    expect(h.current).toMatchObject({ year: 2026, value: 14_000, aportes: 1_000, rendimento: 1_000, estimated: false });
    expect(h.current?.fraction).toBeCloseTo(yearFraction(NOW), 10);
  });

  it("has only a core when the history starts this month, and today's value when there is none", () => {
    expect(ringHistory([month("2026-10", 5_000, 5_000)], 5_200, NOW)).toEqual({ core: { year: 2026, month: 10, value: 5_000 }, past: [], current: null });
    expect(ringHistory([], 3_000, NOW)).toEqual({ core: { year: 2026, month: 10, value: 3_000 }, past: [], current: null });
    expect(ringHistory([month("2026-10", 0, 0)], 0, NOW)).toEqual({ core: null, past: [], current: null });
  });
});

describe("projectedRings", () => {
  const linear = (step: number): ProjectionPoint[] =>
    Array.from({ length: Math.floor(24 / step) + 1 }, (_, i) => ({ monthIndex: i * step, investedValue: 100 + i * step, contributionsToDate: 100 + i * step, growthToDate: 0 }));

  it("reads each December, monthly or yearly sampled, until the target is reached", () => {
    for (const step of [1, 12]) {
      expect(projectedRings(linear(step), NOW, 110, true)).toEqual([
        { year: 2026, value: 102, aportes: 2, rendimento: 0, estimated: false },
        { year: 2027, value: 114, aportes: 12, rendimento: 0, estimated: false },
      ]);
    }
  });

  it("draws ten years when the target is never reached", () => {
    const rings = projectedRings(linear(1), NOW, 1_000_000, false);
    expect(rings).toHaveLength(UNREACHABLE_YEARS + 1);
    expect(rings.at(-1)?.year).toBe(2026 + UNREACHABLE_YEARS);
  });

  it("is empty without a projection", () => {
    expect(projectedRings([], NOW, 100, true)).toEqual([]);
  });
});

describe("buildTrunk", () => {
  const history = ringHistory(
    [month("2023-12", 500, 500), month("2024-12", 3_000, 2_500), month("2025-12", 2_900, 2_700), month("2026-10", 4_000, 3_500)],
    4_000,
    NOW,
  );
  const future = projectedRings(
    [
      { monthIndex: 0, investedValue: 4_000, contributionsToDate: 3_500, growthToDate: 500 },
      { monthIndex: 120, investedValue: 10_000, contributionsToDate: 8_000, growthToDate: 2_000 },
    ],
    NOW,
    10_000,
    true,
  );
  const trunk = buildTrunk(history, future, 10_000, 2036);

  it("never shrinks: a losing year still gets a thin ring", () => {
    const radii = [trunk.core!.r, ...trunk.past.map((r) => r.r), trunk.current!.r, ...trunk.future.map((r) => r.r)];
    radii.slice(1).forEach((r, i) => expect(r).toBeGreaterThanOrEqual(radii[i]));
    const [y2024, y2025] = trunk.past;
    expect(trunk.past.map((r) => r.year)).toEqual([2024, 2025]);
    expect(y2025.value).toBeLessThan(y2024.value);
    expect(y2025.r).toBeCloseTo(y2024.r + TRUNK.minRing, 10);
  });

  it("scales to the FIRE number, with the target on the outer circle even when the last projected ring passes it", () => {
    const over = buildTrunk(history, [...future, { year: 2037, value: 12_000, aportes: 0, rendimento: 0, estimated: false }], 10_000, 2036);
    for (const t of [trunk, over]) {
      expect(t.scale).toBe(10_000);
      expect(t.target).toEqual({ r: TRUNK.radius, value: 10_000 });
    }
    expect(trunk.core?.r).toBeCloseTo(ringRadius(500, 10_000), 10);
  });

  it("labels the core year, today, the arrival year and round years without overlap", () => {
    const kinds = trunk.labels.map((label) => label.kind);
    expect(trunk.core!.r).toBeLessThan(TRUNK.coreTextMinR);
    expect(kinds).toContain("core");
    expect(kinds).toContain("now");
    expect(trunk.labels.find((label) => label.kind === "arrival")?.text).toBe("2036");
    trunk.labels.slice(1).forEach((label, i) => expect(label.x - trunk.labels[i].x).toBeGreaterThanOrEqual(30));
  });

  it("leaves the core's year off the ray when the core shows it", () => {
    const big = buildTrunk(ringHistory([month("2024-12", 6_000, 6_000)], 7_000, NOW), [], 10_000, null);
    expect(big.core!.r).toBeGreaterThanOrEqual(TRUNK.coreTextMinR);
    expect(big.labels.map((label) => label.kind)).toEqual(["now"]);
  });
});

describe("milestones, what-if and the arrival range", () => {
  const ctx = { annualExpenses: 120_000, swr: 0.04, currentInvested: 14_000, fireNumber: 3_000_000, monthlyRealReturn: 0, retirementMonthIndex: 120, currentAge: 40 };
  const rings = [
    { year: 2023, value: 11_000, aportes: 0, rendimento: 0, estimated: false },
    { year: 2026, value: 14_000, aportes: 0, rendimento: 0, estimated: false },
    { year: 2030, value: 40_000, aportes: 0, rendimento: 0, estimated: false },
  ];

  it("gives each milestone the year it was or will be reached", () => {
    const marks = milestoneMarks(
      [
        { id: "a", name: "Primeiros 10 mil", type: "net_worth_absolute", value: 10_500 },
        { id: "b", name: "Renda de 100", type: "passive_income_absolute", value: 100 },
        { id: "c", name: "Muito longe", type: "net_worth_absolute", value: 1_000_000 },
        { id: "d", name: "50 anos", type: "age", value: 50 },
      ],
      ctx,
      rings,
      2022,
      2026,
    );
    expect(marks.map((m) => [m.id, m.reached, m.year, m.threshold])).toEqual([
      ["a", true, 2023, 10_500],
      ["b", false, 2030, 30_000],
      ["c", false, null, 1_000_000],
      ["d", false, 2036, null],
    ]);
  });

  it("answers the what-if like the server's altProjection", () => {
    expect(whatIfArrival(0, 12_000, 0, 1_000, NOW)).toBe(2027);
    expect(whatIfArrival(0, 12_000, 0, 0, NOW)).toBeNull();
  });

  it("finds the 80% arrival range, which collapses to one year without volatility", () => {
    const a = { currentInvested: 0, targetMonthlyIncome: 40, safeWithdrawalRate: 0.04, realAnnualReturn: 0, phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 1_000 }] };
    expect(arrivalRange(a, 12_000, { currentAge: 40, lifeExpectancyAge: 95, annualVolatility: 0 }, NOW)).toEqual({ from: 2027, to: 2027 });
    const spread = arrivalRange({ ...a, realAnnualReturn: 0.05 }, 120_000, { currentAge: 40, lifeExpectancyAge: 95, annualVolatility: 0.15 }, NOW);
    expect(spread).not.toBeNull();
    expect(spread!.from).toBeLessThanOrEqual(spread!.to ?? Infinity);
    expect(arrivalRange(a, 12_000, { currentAge: null, lifeExpectancyAge: 95, annualVolatility: 0.1 }, NOW)).toBeNull();
  });
});
