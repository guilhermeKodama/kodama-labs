import { describe, expect, it } from "vitest";
import { miniBars, rowYear, yearBar, type PhoneMonth } from "../year-phone";

const month = (m: number, spent: number, budget: number | null, isProjected = false): PhoneMonth => ({ month: m, spent, budget, isProjected });

describe("rowYear", () => {
  it("counts the lived months and budgets the whole year", () => {
    const year = rowYear([month(1, 900, 800), month(2, 700, 800), month(3, 450.5, 800), month(4, 600, 800, true)]);
    expect(year).toEqual({ spentToDate: 2050.5, budgetToDate: 2400, budgetYear: 3200, overMonths: 1 });
  });

  it("leaves months without a budget out of the overruns", () => {
    expect(rowYear([month(1, 300, null), month(2, 0, 0)]).overMonths).toBe(0);
  });
});

describe("yearBar", () => {
  it("is red once the year's budget is gone and yellow when it runs ahead of the year", () => {
    expect(yearBar(1300, 1200, 0.9)).toEqual({ ratio: 1300 / 1200, tone: "over" });
    expect(yearBar(800, 1200, 0.5).tone).toBe("ahead");
    expect(yearBar(600, 1200, 0.5).tone).toBe("normal");
  });

  it("stays neutral without a budget", () => {
    expect(yearBar(500, 0, 0.5)).toEqual({ ratio: 0, tone: "normal" });
  });
});

describe("miniBars", () => {
  it("draws every month on the row's own scale with a tick at each budget", () => {
    const bars = miniBars([month(1, 1000, 800), month(2, 400, 800), month(3, 500, null), month(4, 900, 800, true)]);
    expect(bars.map((bar) => bar.tone)).toEqual(["over", "actual", "actual", "projected"]);
    expect(bars[0]).toMatchObject({ height: 1, budgetAt: 0.8 });
    expect(bars[1].height).toBeCloseTo(0.4);
    expect(bars[2].budgetAt).toBeNull();
  });

  it("is flat when nothing was spent or budgeted", () => {
    expect(miniBars([month(1, 0, null)])).toEqual([{ month: 1, height: 0, budgetAt: null, tone: "actual" }]);
  });
});
