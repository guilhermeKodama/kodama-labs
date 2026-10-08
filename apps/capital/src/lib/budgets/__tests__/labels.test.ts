import { describe, expect, it } from "vitest";
import { barHeader, entityBadgeKey, heatmapLegend, insightCopy, monthHeader, monthSpan, resetsLabel, trendBasis, yearHeader, yearToDateMonth, type YearInsight } from "../labels";

const ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const abbr = (m: number) => ABBR[m - 1];
const money = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

describe("month labels", () => {
  const sep = { year: 2026, month: 9, daysElapsed: 22, daysInMonth: 30, isCurrent: true, isPast: false, today: "2026-09-22" };

  it("reads 'Hoje: 22/set · 73% do mês' while the month runs", () => {
    expect(monthHeader(sep, abbr)).toEqual({ key: "month.today", values: { day: "22", month: "set", pct: 73 } });
    expect(monthHeader({ ...sep, today: "2026-10-05", month: 10, daysElapsed: 5, daysInMonth: 31 }, abbr).values).toEqual({ day: "05", month: "out", pct: 16 });
    expect(monthHeader({ ...sep, isCurrent: false, isPast: true }, abbr)).toEqual({ key: "month.closed" });
    expect(monthHeader({ ...sep, isCurrent: false }, abbr)).toEqual({ key: "month.notStarted" });
  });

  it("names today's mark and the reset month", () => {
    expect(barHeader(sep)).toEqual({ key: "month.table.barToday", values: { day: 22 } });
    expect(barHeader({ ...sep, isCurrent: false })).toEqual({ key: "month.table.bar" });
    expect(resetsLabel(9, abbr)).toEqual({ key: "month.table.resets", values: { month: "out" } });
    expect(resetsLabel(12, abbr).values).toEqual({ month: "jan" });
  });
});

describe("year labels", () => {
  it("builds the mockup header from the period", () => {
    expect(monthSpan(6, 8, abbr)).toBe("jun–ago");
    expect(monthSpan(1, 1, abbr)).toBe("jan");
    expect(yearHeader({ nElapsed: 9, completeMonths: 8, isPast: false, projectionBasis: [6, 8] }, abbr)).toEqual({
      key: "year.header.projected",
      values: { actual: "jan–set", projected: "out–dez", basis: "jun–ago" },
    });
    expect(yearHeader({ nElapsed: 1, completeMonths: 0, isPast: false, projectionBasis: null }, abbr)).toEqual({
      key: "year.header.noBasis",
      values: { actual: "jan", projected: "fev–dez" },
    });
    expect(yearHeader({ nElapsed: 12, completeMonths: 12, isPast: true, projectionBasis: null }, abbr)).toEqual({ key: "year.header.done", values: { actual: "jan–dez" } });
    expect(yearHeader({ nElapsed: 0, completeMonths: 0, isPast: false, projectionBasis: null }, abbr)).toEqual({ key: "year.header.future" });
  });

  it("runs the KPIs up to the current month", () => {
    expect(yearToDateMonth({ nElapsed: 9, isPast: false })).toBe(9);
    expect(yearToDateMonth({ nElapsed: 12, isPast: true })).toBe(12);
    expect(yearToDateMonth({ nElapsed: 0, isPast: false })).toBeNull();
  });

  it("names the month in progress in the legend", () => {
    expect(heatmapLegend(9, false, abbr)).toEqual({ key: "year.heatmap.legend", values: { month: "set" } });
    expect(heatmapLegend(12, true, abbr)).toEqual({ key: "year.heatmap.legendNoCurrent" });
  });
});

describe("insightCopy", () => {
  const base: YearInsight = { kind: "overrun", overMonths: 5, nElapsed: 9, avg: 1990, budget: 2000, suggested: 2000, first3: 1957, last3: 2210, growth: 0.13, peakMonth: 8, peakValue: 2310 };

  it("overrun: months over, averages and the suggestion", () => {
    const copy = insightCopy({ ...base, avg: 2062, suggested: 2100 }, "Mercado", abbr, money, [6, 8]);
    expect(copy.title).toEqual({ key: "year.insights.overrunTitle", values: { category: "Mercado", count: 5, total: 9 } });
    expect(copy.body).toEqual({ key: "year.insights.overrunBody", values: { avg: "R$ 2.062", budget: "R$ 2.000" } });
    expect(copy.adjust).toEqual({ amount: 2100, label: { key: "year.insights.adjust", values: { amount: "R$ 2.100" } } });
  });

  it("offers no adjustment when the suggestion is the budget itself", () => {
    expect(insightCopy(base, "Mercado", abbr, money, [6, 8]).adjust).toBeNull();
  });

  it("never suggests lowering a budget that spending runs over", () => {
    expect(insightCopy({ ...base, avg: 1884, suggested: 1900 }, "Mercado", abbr, money, [6, 8]).adjust).toBeNull();
  });

  it("names the last three complete months, separate from the projection window", () => {
    expect(trendBasis(8)).toEqual([6, 8]);
    expect(trendBasis(2)).toEqual([1, 2]);
    expect(trendBasis(0)).toBeNull();
  });

  it("growth: first three months against the last three complete ones", () => {
    const copy = insightCopy({ ...base, kind: "growth", growth: 0.178, first3: 1220, last3: 1437 }, "Software", abbr, money, [6, 8]);
    expect(copy.title).toEqual({ key: "year.insights.growthTitle", values: { category: "Software", pct: 18 } });
    expect(copy.body.values).toEqual({ first: "jan–mar", firstAvg: "R$ 1.220", last: "jun–ago", lastAvg: "R$ 1.437" });
    expect(copy.adjust).toBeNull();
  });

  it("seasonal: the peak month and value", () => {
    const copy = insightCopy({ ...base, kind: "seasonal", peakMonth: 6, peakValue: 1900 }, "Lazer", abbr, money, [6, 8]);
    expect(copy.title).toEqual({ key: "year.insights.seasonalTitle", values: { category: "Lazer" } });
    expect(copy.body).toEqual({ key: "year.insights.seasonalBody", values: { month: "jun", value: "R$ 1.900" } });
  });
});

describe("entityBadgeKey", () => {
  const kinds = new Map([
    ["pf", "personal"],
    ["ltda", "business"],
    ["llc", "business"],
  ]);

  it("shows the mockup's short PF / PJ, never the company name", () => {
    expect(entityBadgeKey("pf", kinds)).toBe("scope.pf");
    expect(entityBadgeKey("ltda", kinds)).toBe("scope.pj");
    expect(entityBadgeKey("llc", kinds)).toBe("scope.pj");
  });

  it("shows Todas for a budget for every entity, nothing for an unknown entity", () => {
    expect(entityBadgeKey(null, kinds)).toBe("scope.all");
    expect(entityBadgeKey("gone", kinds)).toBeNull();
  });
});
