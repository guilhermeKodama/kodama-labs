import { describe, expect, it } from "vitest";
import { budgetsParams, monthTense, openMonth, parseScope, resolveBudgetsView, stepView, switchMode } from "../url";

const today = { year: 2026, month: 10 };
const none = { mode: null, m: null, y: null, scope: null };

describe("resolveBudgetsView", () => {
  it("opens today's month for every entity by default", () => {
    expect(resolveBudgetsView(none, today)).toEqual({ mode: "month", month: { year: 2026, month: 10 }, year: 2026, scope: "all" });
  });

  it("reads mode, month, year and scope", () => {
    expect(resolveBudgetsView({ mode: "year", m: "2025-03", y: "2024", scope: "pj" }, today)).toEqual({
      mode: "year",
      month: { year: 2025, month: 3 },
      year: 2024,
      scope: "pj",
    });
    // Without y, the year follows m.
    expect(resolveBudgetsView({ ...none, mode: "year", m: "2025-03" }, today).year).toBe(2025);
  });

  it("ignores malformed params", () => {
    expect(resolveBudgetsView({ mode: "week", m: "2026-13", y: "abc", scope: "<script>" }, today)).toEqual(resolveBudgetsView(none, today));
    expect(parseScope("cmabc123")).toBe("cmabc123");
    expect(parseScope("")).toBe("all");
  });
});

describe("budgetsParams", () => {
  it("leaves defaults out of the URL", () => {
    expect(budgetsParams(resolveBudgetsView(none, today), today)).toEqual(none);
  });

  it("keeps what differs from today", () => {
    const view = { mode: "year" as const, month: { year: 2026, month: 9 }, year: 2025, scope: "pf" };
    expect(budgetsParams(view, today)).toEqual({ mode: "year", m: "2026-09", y: "2025", scope: "pf" });
    // The year is only written in Anual.
    expect(budgetsParams({ ...view, mode: "month" }, today).y).toBeNull();
  });

  it("round-trips", () => {
    const view = { mode: "year" as const, month: { year: 2026, month: 2 }, year: 2027, scope: "pj" };
    expect(resolveBudgetsView(budgetsParams(view, today), today)).toEqual(view);
  });
});

describe("navigation", () => {
  const month = resolveBudgetsView({ ...none, m: "2026-01" }, today);

  it("steps months in Mensal and years in Anual", () => {
    expect(stepView(month, -1).month).toEqual({ year: 2025, month: 12 });
    expect(stepView({ ...month, mode: "year", year: 2026 }, 1).year).toBe(2027);
  });

  it("switches to Anual on the year on screen and back to the same month", () => {
    const year = switchMode(month, "year", today);
    expect(year).toMatchObject({ mode: "year", year: 2026 });
    expect(switchMode(year, "month", today).month).toEqual({ year: 2026, month: 1 });
  });

  it("coming back from another year opens today's month, December of a past year or January of a future one", () => {
    const view = { ...month, mode: "year" as const };
    expect(switchMode({ ...view, month: { year: 2020, month: 5 }, year: 2026 }, "month", today).month).toEqual({ year: 2026, month: 10 });
    expect(switchMode({ ...view, year: 2024 }, "month", today).month).toEqual({ year: 2024, month: 12 });
    expect(switchMode({ ...view, year: 2028 }, "month", today).month).toEqual({ year: 2028, month: 1 });
  });

  it("opens a heatmap cell's month", () => {
    expect(openMonth({ ...month, mode: "year", year: 2025 }, 7)).toMatchObject({ mode: "month", month: { year: 2025, month: 7 } });
  });

  it("tells past, current and future months", () => {
    expect(monthTense({ year: 2026, month: 9 }, today)).toBe("past");
    expect(monthTense({ year: 2026, month: 10 }, today)).toBe("current");
    expect(monthTense({ year: 2027, month: 1 }, today)).toBe("future");
  });
});
