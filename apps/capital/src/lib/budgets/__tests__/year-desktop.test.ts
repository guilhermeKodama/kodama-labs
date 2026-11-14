import { describe, expect, it } from "vitest";
import { heatSections, kindMonths, kindSummaries, sectionOf } from "../year-desktop";

const months = (spent: number, budget: number | null, projectedFrom = 13) =>
  Array.from({ length: 12 }, (_, i) => ({ spent, budget, projected: i + 1 >= projectedFrom ? spent * 2 : spent }));

const row = (name: string, kind: string | null, spent: number, budget: number | null, extra: { isBudgeted?: boolean; overMonths?: number; budgetedMonths?: number } = {}) => ({
  name,
  kind,
  isBudgeted: extra.isBudgeted ?? true,
  months: months(spent, budget),
  overMonths: extra.overMonths ?? 0,
  budgetedMonths: extra.budgetedMonths ?? (budget ? 12 : 0),
  yearTotal: spent * 12,
});

describe("sectionOf", () => {
  it("puts a row without a budget apart, and a null kind under variável", () => {
    expect(sectionOf({ kind: "fixo" })).toBe("fixo");
    expect(sectionOf({ kind: null })).toBe("variavel");
    expect(sectionOf({ kind: "fixo", isBudgeted: false })).toBe("none");
  });
});

describe("heatSections", () => {
  const rows = [row("Lazer", "variavel", 100, 200), row("Moradia", "fixo", 1000, 1100), row("Software", "fixo", 50, 80), row("Pets", null, 300, null, { isBudgeted: false }), row("Mercado", null, 400, 500)];

  it("orders Fixo, Variável, Sem orçamento and sorts each by the year", () => {
    const sections = heatSections(rows, 11);
    expect(sections.map((s) => s.kind)).toEqual(["fixo", "variavel", "none"]);
    expect(sections[0].rows.map((r) => r.name)).toEqual(["Moradia", "Software"]);
    expect(sections[1].rows.map((r) => r.name)).toEqual(["Mercado", "Lazer"]);
  });

  it("adds each section's months, and the sections add up to the whole", () => {
    const sections = heatSections(rows, 11);
    expect(sections[0].monthTotals[0]).toBe(1050);
    expect(sections[0].monthBudgets[0]).toBe(1180);
    expect(sections[2].monthBudgets[0]).toBe(0);
    const all = sections.reduce((sum, s) => sum + s.monthTotals[0], 0);
    expect(all).toBe(1850);
  });

  it("leaves empty sections out", () => {
    expect(heatSections([row("Moradia", "fixo", 1, 1)], 11).map((s) => s.kind)).toEqual(["fixo"]);
    expect(heatSections([], 11)).toEqual([]);
  });
});

describe("kindSummaries", () => {
  it("splits spend so far between fixo and variável, leaving unbudgeted rows out", () => {
    const summary = kindSummaries([row("Moradia", "fixo", 300, 300, { overMonths: 2 }), row("Lazer", "variavel", 100, 50), row("Pets", null, 999, null, { isBudgeted: false })], 2);
    expect(summary.fixo.summary.spentToDate).toBe(600);
    expect(summary.variavel.summary.spentToDate).toBe(200);
    expect(summary.total).toBe(800);
    expect(summary.fixo.share).toBeCloseTo(0.75);
    expect(summary.variavel.share).toBeCloseTo(0.25);
    expect(summary.fixo.summary.overBudgetMonths).toBe(2);
  });

  it("has no share when nothing was spent", () => {
    const summary = kindSummaries([row("Moradia", "fixo", 0, 300)], 3);
    expect(summary.total).toBe(0);
    expect(summary.fixo.share).toBe(0);
  });
});

describe("kindMonths", () => {
  it("reads a lived month's spend and a projected month's projection", () => {
    const out = kindMonths({ monthTotals: [10, 20, 0], monthProjected: [10, 25, 30], monthBudgets: [15, 0, 15] }, (m) => m === 3);
    expect(out).toEqual([
      { month: 1, spent: 10, budget: 15, isProjected: false },
      { month: 2, spent: 20, budget: null, isProjected: false },
      { month: 3, spent: 30, budget: 15, isProjected: true },
    ]);
  });
});
