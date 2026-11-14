import { describe, expect, it } from "vitest";
import {
  budgetedSpan,
  detectRecurring,
  dueRuleOccurrences,
  dropHighOutlier,
  legacyFutureMonth,
  legacyMonthProjection,
  legacyStillToCome,
  legacyTrend,
  median,
  merchantKey,
  occurrencesIn,
  projectFutureMonth,
  projectMonth,
  recurringExpectation,
  robustCenter,
  robustTrend,
  sameMonthHistory,
  type HistoryMonth,
  type MonthProjectionInput,
} from "../project";

const month = (total: number, rest: number): HistoryMonth => ({ total, rest });

function project(partial: Partial<MonthProjectionInput> & Pick<MonthProjectionInput, "kind" | "spent" | "history">) {
  return projectMonth({ committed: partial.committed ?? partial.spent, budget: partial.budget ?? 0, ...partial });
}

describe("robust center", () => {
  it("drops one high month and keeps a series that is high all the way through", () => {
    expect(dropHighOutlier([2000, 2000, 2000, 2000, 2000, 150000])).toEqual({ values: [2000, 2000, 2000, 2000, 2000], dropped: true });
    expect(dropHighOutlier([8000, 9000, 8500, 8800]).dropped).toBe(false);
    expect(dropHighOutlier([6000, 8000]).dropped).toBe(false);
    expect(dropHighOutlier([0, 0, 0, 10]).dropped).toBe(false);
  });

  it("takes the median from three months, the smaller of two, and leaves a net credit out of a level", () => {
    expect(robustCenter([1780, 1990, 2080, 2100, 2240, 2310], "level")?.value).toBe(2090);
    expect(robustCenter([6000, 8000], "level")?.value).toBe(6000);
    expect(robustCenter([150000], "level")?.value).toBe(150000);
    expect(robustCenter([-11294, -400, 500, 500, 500], "level")?.value).toBe(500);
    expect(robustCenter([-1], "level")).toBeNull();
    expect(median([])).toBe(0);
  });

  it("reads a credit in the tail as nothing arriving", () => {
    expect(robustCenter([0, 0, 0, 0], "tail")?.value).toBe(0);
    expect(robustCenter([-20, 0, 10], "tail")?.value).toBe(0);
  });
});

describe("fixed month", () => {
  it("does not add a rent that already posted, even when it usually posts after today", () => {
    // Six months of 16,000 on the 20th: on the 14th the whole rent is history's tail. This month it posted on the 8th.
    const history = Array.from({ length: 6 }, () => month(16000, 16000));
    expect(project({ kind: "fixo", spent: 15921, history, budget: 16685 })).toEqual({ total: 16000, method: "fixed_history", outlierMonths: 0 });
    const tails = history.map((h) => h.rest);
    expect(legacyMonthProjection({ spent: 15921, committed: 15921, daysElapsed: 14, daysInMonth: 30, totals: history.map((h) => h.total), tails })).toBe(31921);
  });

  it("stops at what is booked once every recurring charge posted", () => {
    const history = Array.from({ length: 6 }, () => month(16000, 16000));
    expect(project({ kind: "fixo", spent: 15921, history, budget: 16685, recurring: { expected: 16000, pending: 0 } })).toEqual({ total: 15921, method: "fixed_booked", outlierMonths: 0 });
  });

  it("adds a recurring charge that is still due on top of what posted", () => {
    // Rent posted, the condomínio (1,200) has not.
    const history = Array.from({ length: 4 }, () => month(17200, 17200));
    expect(project({ kind: "fixo", spent: 16000, history, budget: 18000, recurring: { expected: 17200, pending: 1200 } }).total).toBe(17200);
    // Booked later this month already: not a second copy.
    expect(project({ kind: "fixo", spent: 16000, committed: 17200, history, budget: 18000, recurring: { expected: 17200, pending: 1200 } }).total).toBe(17200);
  });

  it("is never the daily rate, with or without history", () => {
    // 1,800 of a 2,000 budget on day 14 of 30, no history. The daily rate says 3,857.
    expect(project({ kind: "fixo", spent: 1800, history: [], budget: 2000 })).toEqual({ total: 2000, method: "fixed_budget", outlierMonths: 0 });
    expect(legacyMonthProjection({ spent: 1800, committed: 1800, daysElapsed: 14, daysInMonth: 30, totals: [], tails: [] })).toBeCloseTo(3857.14, 2);
    expect(project({ kind: "fixo", spent: 300, history: [], budget: 0 })).toEqual({ total: 300, method: "fixed_booked", outlierMonths: 0 });
  });

  it("stays on what was spent once that passes the expected month", () => {
    const history = Array.from({ length: 5 }, () => month(480, 0));
    expect(project({ kind: "fixo", spent: 823, history, budget: 500 })).toMatchObject({ total: 823, method: "fixed_booked" });
  });

  it("does not trust one anomalous month", () => {
    expect(project({ kind: "fixo", spent: 0, history: [month(150000, 0)], budget: 5000 }).total).toBe(5000);
    expect(project({ kind: "fixo", spent: 0, history: [month(6000, 0)], budget: 5000 }).total).toBe(6000);
  });

  it("projects the net of a bill that is reimbursed every month, not the gross charge", () => {
    const history = Array.from({ length: 6 }, () => month(888, 0));
    // The charge is 6,408 and the credit is 5,520; the month nets about 888.
    expect(project({ kind: "fixo", spent: 888, history, recurring: { expected: 6408, pending: 0 } })).toMatchObject({ total: 888, method: "fixed_booked" });
    expect(project({ kind: "fixo", spent: 0, history, recurring: { expected: 6408, pending: 6408 } }).total).toBe(888);
    // One cheap month is not a reimbursement pattern.
    const mixed = [6408, 6408, 6300, 6408, 888, 6408].map((total) => month(total, 0));
    expect(project({ kind: "fixo", spent: 0, history: mixed, recurring: { expected: 6408, pending: 6408 } }).total).toBe(6408);
  });

  it("uses the recurring charges with thin history, and a higher median when the rent went up", () => {
    expect(project({ kind: "fixo", spent: 0, history: [month(40000, 0)], budget: 500, recurring: { expected: 480, pending: 480 } }).total).toBe(480);
    const raised = [18000, 18200, 18100, 18300].map((total) => month(total, 0));
    expect(project({ kind: "fixo", spent: 0, history: raised, budget: 16000, recurring: { expected: 10000, pending: 10000 } }).total).toBe(18150);
  });

  it("flags an outlier month and never goes negative", () => {
    const history = [500, 500, 500, 500, 9000].map((total) => month(total, 0));
    expect(project({ kind: "fixo", spent: 0, history, budget: 500 }).outlierMonths).toBe(1);
    expect(project({ kind: "fixo", spent: -400, committed: -400, history: [month(-11294, 0), month(-800, 0)], budget: 0 }).total).toBe(0);
  });
});

describe("variable month", () => {
  it("adds what usually arrives after today", () => {
    const history = [1, 2, 3].map(() => month(1200, 600));
    expect(project({ kind: "variavel", spent: 600, history, budget: 2000 })).toEqual({ total: 1200, method: "variable_history", outlierMonths: 0 });
  });

  it("keeps a card's later swipes when this month is already ahead, and does not count a booked swipe twice", () => {
    const history = [1, 2, 3].map(() => month(1000, 900));
    expect(project({ kind: "variavel", spent: 400, committed: 450, history, budget: 20000 }).total).toBe(1300);
  });

  it("does not let one outlier month set the rest of the month", () => {
    const history = [2000, 2000, 2000, 2000, 2000, 150000].map((total) => month(total, total));
    expect(project({ kind: "variavel", spent: 1500, history, budget: 5000 })).toMatchObject({ total: 3500, outlierMonths: 1 });
  });

  it("with two months uses the smaller tail", () => {
    expect(project({ kind: "variavel", spent: 1000, history: [month(6000, 6000), month(8000, 8000)], budget: 20000 }).total).toBe(7000);
  });

  it("with one month blends it with the budget for the days that are left", () => {
    // Tail 400; the budget left for half a month is 500. (400 + 500) / 2 = 450 still to come.
    expect(project({ kind: "variavel", spent: 300, history: [month(800, 400)], budget: 1000, elapsed: 0.5 }).total).toBe(750);
    expect(project({ kind: "variavel", spent: 200, history: [month(150000, 150000)], budget: 1000, elapsed: 0.5 }).total).toBe(700);
    expect(project({ kind: "variavel", spent: 200, history: [month(900, 600)], budget: 0 }).total).toBe(800);
  });

  it("without history assumes the rest of the budget, and without a budget only what is booked", () => {
    expect(project({ kind: "variavel", spent: 220, history: [], budget: 5000 })).toEqual({ total: 5000, method: "variable_budget", outlierMonths: 0 });
    expect(project({ kind: "variavel", spent: 6000, history: [], budget: 5000 }).total).toBe(6000);
    expect(project({ kind: "variavel", spent: 220, history: [], budget: 0 })).toEqual({ total: 220, method: "variable_booked", outlierMonths: 0 });
  });

  it("is done once a lump has already landed", () => {
    const history = [1, 2, 3, 4].map(() => month(16000, 16000));
    expect(project({ kind: "variavel", spent: 15921, history, budget: 16685 }).total).toBe(15921);
  });

  it("keeps a recurring rule that is still due", () => {
    expect(project({ kind: "variavel", spent: 100, history: [], budget: 0, recurring: { expected: 90, pending: 90 } }).total).toBe(190);
  });
});

describe("future months", () => {
  it("projects the median of recent months and ignores one outlier", () => {
    expect(projectFutureMonth({ history: [2100, 1780, 1990, 2240, 2080, 2310], budget: 2000, committed: 0 })).toBe(2090);
    expect(projectFutureMonth({ history: [2000, 2000, 2000, 2000, 2000, 150000], budget: 2000, committed: 0 })).toBe(2000);
    expect(projectFutureMonth({ history: [600, 800], budget: null, committed: 0 })).toBe(600);
    expect(projectFutureMonth({ history: [], budget: 700, committed: 0 })).toBe(700);
  });

  it("does not copy one anomalous month, and floors a run of credits at zero", () => {
    expect(projectFutureMonth({ history: [150000], budget: 5000, committed: 0 })).toBe(5000);
    expect(projectFutureMonth({ history: [-11294, -4000, -3000], budget: null, committed: -11294 })).toBe(0);
  });

  it("keeps an installment already booked", () => {
    expect(projectFutureMonth({ history: [400, 420, 410], budget: 500, committed: 900 })).toBe(900);
  });

  it("blends a season only when two earlier years agree", () => {
    expect(projectFutureMonth({ history: [800, 820, 810, 790], budget: 800, committed: 0, seasonal: [1200, 1100] })).toBe(977.5);
    expect(projectFutureMonth({ history: [800, 820, 810, 790], budget: 800, committed: 0, seasonal: [5000] })).toBe(805);
    expect(projectFutureMonth({ history: [800, 820, 810, 790], budget: 800, committed: 0, seasonal: [800, 8000] })).toBe(805);
    expect(projectFutureMonth({ history: [], budget: null, committed: 0, seasonal: [300, 320] })).toBe(310);
  });

  it("assigns an earlier year to the budget that would own it", () => {
    const rows = [
      { entityId: "pf", categoryId: "rent", year: 2024, month: 12, total: 1000 },
      { entityId: "pf", categoryId: "rent", year: 2025, month: 12, total: 1100 },
      { entityId: "pj", categoryId: "rent", year: 2025, month: 12, total: 400 },
      { entityId: "pf", categoryId: "rent", year: 2025, month: 11, total: 9 },
    ];
    expect(sameMonthHistory(rows, { entityId: "pf", categoryId: "rent" }, 12, [])).toEqual([1000, 1100]);
    expect(sameMonthHistory(rows, { entityId: null, categoryId: "rent" }, 12, ["pj"])).toEqual([1000, 1100]);
    expect(sameMonthHistory(rows, { entityId: null, categoryId: "rent" }, 12, [])).toEqual([1000, 1500]);
  });
});

describe("trend", () => {
  it("compares the last three months with the three before them", () => {
    expect(robustTrend([50, 60, 150, 160, 170, 180, 190, 200])).toBe(0.1875);
    expect(legacyTrend([50, 60, 150, 160, 170, 180, 190, 200])).toBe(1.1923);
    expect(robustTrend([400, 410, 405, 400, 410, 405])).toBe(0);
  });

  it("shows a dash for a series that just turned on, a near-empty base or too little data", () => {
    expect(robustTrend([10, 20, 30, 40, 800, 900, 1000])).toBeNull();
    expect(robustTrend([100, 100, 100, 110, 120])).toBeNull();
    expect(robustTrend([0, 0, 10, 400, 400, 400])).toBeNull();
    expect(robustTrend([20, 30, 40, 50, 60, 70])).toBeNull();
    expect(legacyTrend([0, 0, 0, 1, 1, 1])).toBeNull();
  });
});

describe("recurring charges", () => {
  it("folds a merchant and drops installment marks and digits", () => {
    expect(merchantKey("NETFLIX.COM 11/26")).toBe("netflix com");
    expect(merchantKey("Sofá (3/10)")).toBe("sofa");
    expect(merchantKey("1234")).toBe("");
  });

  it("needs three of six months, two of the last three, and a stable amount", () => {
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const charges = months.flatMap((m, i) => [
      { month: m, key: "aluguel", day: 20, amount: 16000 },
      { month: m, key: "luz", day: 12, amount: 180 + i },
      { month: m, key: "amazon", day: 3, amount: i % 2 ? 50 : 900 },
    ]);
    const old = [{ month: "2026-04", key: "academia", day: 5, amount: 99 }, ...["2026-05", "2026-06", "2026-07"].map((m) => ({ month: m, key: "academia", day: 5, amount: 99 }))];
    const found = detectRecurring([...charges, ...old, { month: "2026-11", key: "aluguel", day: 8, amount: 15921 }, { month: "2026-11", key: "x", day: 1, amount: 0 }], "2026-11");
    expect(found.map((b) => [b.key, b.amount, b.posted])).toEqual([
      ["aluguel", 16000, true],
      ["luz", 182.5, false],
    ]);
    expect(detectRecurring(charges.slice(0, 6), "2026-11")).toEqual([]);
  });

  it("adds a rule that is due and has no history, but not one already detected", () => {
    const bills = [{ key: "rule:a", amount: 1000, day: 5, seen: 4, posted: true, postedAmount: 1000 }, { key: "luz", amount: 200, day: 9, seen: 3, posted: false, postedAmount: 50 }];
    expect(recurringExpectation(bills, [{ key: "rule:a", amount: 1000 }, { key: "rule:b", amount: 90 }])).toEqual({ expected: 1290, pending: 240 });
  });

  it("treats a same-sized charge under another key as the bill, and does not stack a rule on a bill of the same size", () => {
    const rent = { key: "rule:rent", amount: 14732, day: 10, seen: 4, posted: false, postedAmount: 0 };
    const booked = [{ key: "aluguel", amount: 14732 }];
    expect(recurringExpectation([rent], [], booked)).toEqual({ expected: 14732, pending: 0 });
    // The detected bill already is this rule.
    expect(recurringExpectation([rent], [{ key: "rule:other", amount: 15000 }], booked)).toEqual({ expected: 14732, pending: 0 });
    // Nothing posted yet: the rule is the whole month.
    expect(recurringExpectation([], [{ key: "rule:rent", amount: 14732 }], [])).toEqual({ expected: 14732, pending: 14732 });
  });

  it("reduces what is still pending by booked spend no bill claimed", () => {
    // 40 is not within a third of 90, so it is not that bill, but it still is not added on top.
    expect(recurringExpectation([], [{ key: "rule:soft", amount: 90 }], [{ key: "compra", amount: 40 }])).toEqual({ expected: 90, pending: 50 });
  });

  it("does not count a rule that missed its last occurrence, unless it booked recently", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-11-30T23:59:59.999Z");
    const stale = { key: "rule:rent", amount: 14732, nextDue: new Date("2026-09-30T00:00:00Z"), frequency: "monthly", endDate: null, bookedRecently: false };
    expect(dueRuleOccurrences([stale], start, end)).toEqual([]);
    // Booked in the last two months: one occurrence this month, not one per missed month.
    expect(dueRuleOccurrences([{ ...stale, bookedRecently: true }], start, end)).toEqual([{ key: "rule:rent", amount: 14732 }]);
    expect(dueRuleOccurrences([{ ...stale, nextDue: new Date("2026-11-10T00:00:00Z") }], start, end)).toEqual([{ key: "rule:rent", amount: 14732 }]);
    expect(dueRuleOccurrences([{ ...stale, nextDue: new Date("2026-11-10T00:00:00Z"), endDate: new Date("2026-10-01T00:00:00Z") }], start, end)).toEqual([]);
    expect(occurrencesIn(new Date("2026-10-20T00:00:00Z"), "monthly", start, end, null)).toBe(1);
    expect(occurrencesIn(new Date("2026-11-10T00:00:00Z"), "weekly", start, end, null)).toBe(3);
    expect(occurrencesIn(new Date("2026-11-28T00:00:00Z"), "daily", start, end, new Date("2026-11-29T00:00:00Z"))).toBe(2);
    expect(occurrencesIn(new Date("2026-01-15T00:00:00Z"), "yearly", start, end, null)).toBe(0);
  });
});

describe("helpers", () => {
  it("names the months that had a budget", () => {
    expect(budgetedSpan([11, 9, 10])).toEqual({ from: 9, to: 11, contiguous: true, count: 3 });
    expect(budgetedSpan([1, 3])).toEqual({ from: 1, to: 3, contiguous: false, count: 2 });
    expect(budgetedSpan([])).toBeNull();
  });

  it("keeps the replaced formulas for the backtest", () => {
    expect(legacyStillToCome([], [], 10)).toBe(0);
    expect(legacyMonthProjection({ spent: 100, committed: 150, daysElapsed: 0, daysInMonth: 30, totals: [], tails: [] })).toBe(150);
    expect(legacyFutureMonth([0, 0, -500, -300], 0)).toBe(0);
    expect(legacyFutureMonth([0, 100, -500, -300, -200], -50)).toBe(-50);
  });
});
