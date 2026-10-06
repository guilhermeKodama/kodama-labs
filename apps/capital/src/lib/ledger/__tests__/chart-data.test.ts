import { describe, expect, it } from "vitest";
import { appliesTop, buildChartData, metricValue, pieItems, waterfallItems } from "@/lib/ledger/chart-data";
import { group } from "./fixtures";

const base = { type: "bar" as const, metric: "sum" as const, cumulative: false, top: 0, hasSeries: false };

describe("chart data", () => {
  it("draws Σ as absolute values, counts rows and averages |Σ| per row", () => {
    expect(metricValue({ sum: -300, count: 3 }, "sum")).toBe(300);
    expect(metricValue({ sum: -300, count: 3 }, "count")).toBe(3);
    expect(metricValue({ sum: -300, count: 3 }, "avg")).toBe(100);
    expect(metricValue({ sum: 0, count: 0 }, "avg")).toBe(0);
    const data = buildChartData([group("a", -100.4, 2), group("b", 50, 1)], base);
    expect(data.series).toEqual([{ key: null, values: [100, 50] }]);
    expect(data.signed).toEqual([-100.4, 50]);
  });

  it("keeps the top N by the metric and folds the rest into Outros with summed Σ and count", () => {
    const groups = [group("a", -1000, 1), group("b", -10, 10), group("c", -300, 3), group("d", -200, 1)];
    const data = buildChartData(groups, { ...base, metric: "avg", top: 2 });
    // avg: a 1000, b 1, c 100, d 200 → a, d, then Outros (b + c: Σ 310 / 13 rows).
    expect(data.categories).toEqual([{ key: "a" }, { key: "d" }, { key: null, others: ["c", "b"] }]);
    expect(data.series[0].values).toEqual([1000, 200, Math.round(310 / 13)]);
    expect(appliesTop("line", 2, 4)).toBe(false);
    expect(appliesTop("bar", 5, 5)).toBe(false);
    expect(buildChartData(groups, { ...base, type: "line", top: 2 }).categories).toHaveLength(4);
  });

  it("pivots series from the children, zero-filled and ordered by weight", () => {
    const groups = [
      group("2026-08", -300, 3, [group("pf", -100, 1), group("pj", -200, 2)]),
      group("2026-09", -50, 1, [group("pf", -50, 1)]),
    ];
    const data = buildChartData(groups, { ...base, hasSeries: true });
    expect(data.hasSeries).toBe(true);
    expect(data.series).toEqual([
      { key: "pj", values: [200, 0] },
      { key: "pf", values: [100, 50] },
    ]);
  });

  it("orders time series ascending", () => {
    const groups = [group("pf", -300, 2, [group("2026-09", -100, 1), group("2026-08", -200, 1)])];
    expect(buildChartData(groups, { ...base, hasSeries: true, timeSeries: true }).series.map((s) => s.key)).toEqual(["2026-08", "2026-09"]);
  });

  it("runs Acumulado per series, only for bar, line and area", () => {
    const groups = [group("d1", -10, 1, [group("x", -10, 1)]), group("d2", -20, 1, [group("x", -5, 1), group("y", -15, 1)])];
    const area = buildChartData(groups, { ...base, type: "area", cumulative: true, hasSeries: true });
    expect(area.series).toEqual([
      { key: "x", values: [10, 15] },
      { key: "y", values: [0, 15] },
    ]);
    expect(buildChartData(groups, { ...base, type: "pie", cumulative: true }).series[0].values).toEqual([10, 20]);
  });

  it("turns 100% bars into shares of each category", () => {
    const groups = [group("a", -100, 2, [group("x", -25, 1), group("y", -75, 1)])];
    expect(buildChartData(groups, { ...base, type: "bar100", hasSeries: true }).series.map((s) => s.values[0])).toEqual([0.75, 0.25]);
  });

  it("feeds the waterfall signed sums without zeros and the pie positive values", () => {
    const data = buildChartData([group("receita", 1000, 1), group("zero", 0, 2), group("mercado", -300, 3)], { ...base, type: "waterfall" });
    expect(waterfallItems(data).map((i) => [i.category.key, i.value])).toEqual([
      ["receita", 1000],
      ["mercado", -300],
    ]);
    expect(pieItems(data, "sum").map((i) => i.category.key)).toEqual(["receita", "mercado"]);
  });
});
