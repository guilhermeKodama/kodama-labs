import { describe, expect, it } from "vitest";
import { columnTense, flatMonthlyBudget, heatLevel, heatPercent, isClickable, monthlyBars, totalTone, trendOf } from "../heatmap";

describe("heatLevel", () => {
  it("shades by how close to the limit, red once passed", () => {
    expect(heatLevel({ spent: 912, budget: 800, isProjected: false })).toBe("over");
    expect(heatLevel({ spent: 1800, budget: 1800, isProjected: false })).toBe("high");
    expect(heatLevel({ spent: 1440, budget: 2000, isProjected: false })).toBe("mid");
    expect(heatLevel({ spent: 380, budget: 1000, isProjected: false })).toBe("low");
  });

  it("never colors a projection, and leaves months without a budget empty", () => {
    expect(heatLevel({ spent: 5000, budget: 800, isProjected: true })).toBe("projected");
    expect(heatLevel({ spent: 300, budget: null, isProjected: false })).toBe("empty");
    expect(isClickable({ spent: 1, budget: 1, isProjected: true })).toBe(false);
  });

  it("shows whole percents", () => {
    expect(heatPercent({ spent: 912, budget: 800 })).toBe(114);
    expect(heatPercent({ spent: 912, budget: null })).toBeNull();
  });
});

describe("columnTense", () => {
  it("marks the current month and projects the rest of the year", () => {
    expect(columnTense(8, 9, false)).toBe("actual");
    expect(columnTense(9, 9, false)).toBe("current");
    expect(columnTense(10, 9, false)).toBe("projected");
    expect(columnTense(12, 12, true)).toBe("actual");
    expect(columnTense(1, 0, false)).toBe("projected");
  });
});

describe("totals and trend", () => {
  it("reds a realized month above its budget", () => {
    expect(totalTone(17000, 16800, false)).toBe("over");
    expect(totalTone(17000, 16800, true)).toBe("projected");
    expect(totalTone(16000, 16800, false)).toBe("normal");
  });

  it("classifies the trend like the mockup (±10%)", () => {
    expect(trendOf(0.18)).toEqual({ kind: "up", pct: 18 });
    expect(trendOf(-0.25)).toEqual({ kind: "down", pct: 25 });
    expect(trendOf(0.05)).toEqual({ kind: "stable", pct: 0 });
    expect(trendOf(null)).toEqual({ kind: "none", pct: 0 });
  });

  it("draws one Orçado/mês line only when every budgeted month has the same total", () => {
    expect(flatMonthlyBudget([16800, 16800, 0, 16800])).toBe(16800);
    expect(flatMonthlyBudget([16000, 16800])).toBeNull();
    expect(flatMonthlyBudget([0, 0])).toBeNull();
  });

  it("splits realized and projected months into stacked series", () => {
    const bars = monthlyBars([1000, 2000, 3000], (m) => m > 2, (v) => Math.round(v / 100) / 10);
    expect(bars).toEqual([
      { month: 1, real: 1, proj: 0 },
      { month: 2, real: 2, proj: 0 },
      { month: 3, real: 0, proj: 3 },
    ]);
  });
});
