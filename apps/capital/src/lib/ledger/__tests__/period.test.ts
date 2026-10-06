import { describe, expect, it } from "vitest";
import { currentMonth, isSteppable, monthEndDate, periodDays, presetMonths, stepPeriod, todayIso } from "@/lib/ledger/period";

const today = { year: 2026, month: 9 };

describe("view period", () => {
  it("resolves each preset to months, like the server", () => {
    expect(presetMonths("this_month", 0, today)).toEqual({ from: "2026-09", to: "2026-09" });
    expect(presetMonths("this_month", -9, today)).toEqual({ from: "2025-12", to: "2025-12" });
    expect(presetMonths("last_month", 0, today)).toEqual({ from: "2026-08", to: "2026-08" });
    expect(presetMonths("last_3m", 0, today)).toEqual({ from: "2026-07", to: "2026-09" });
    expect(presetMonths("last_3m", -1, today)).toEqual({ from: "2026-04", to: "2026-06" });
    expect(presetMonths("ytd", 0, today)).toEqual({ from: "2026-01", to: "2026-09" });
    expect(presetMonths("ytd", -1, today)).toEqual({ from: "2025-01", to: "2025-12" });
    expect(presetMonths("last_12m", 0, today)).toEqual({ from: "2025-10", to: "2026-09" });
    expect(presetMonths("all", 0, today)).toBeNull();
  });

  it("steps back freely and forward up to the current period", () => {
    expect(stepPeriod({ preset: "this_month", offset: 0 }, -1)).toEqual({ preset: "this_month", offset: -1 });
    expect(stepPeriod({ preset: "this_month", offset: 0 }, 1)).toEqual({ preset: "this_month", offset: 0 });
    expect(stepPeriod({ from: "2026-01-01", to: "2026-01-31" }, -1)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(isSteppable({ preset: "all", offset: 0 })).toBe(false);
    expect(isSteppable({ preset: "ytd", offset: 0 })).toBe(true);
    expect(isSteppable({ from: "2026-01-01", to: "2026-01-31" })).toBe(false);
  });

  it("gives the days a period covers", () => {
    expect(monthEndDate("2026-02")).toBe("2026-02-28");
    expect(periodDays({ preset: "last_3m", offset: 0 }, today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodDays({ from: "2026-09-05", to: "2026-09-20" }, today)).toEqual({ from: "2026-09-05", to: "2026-09-20" });
    expect(periodDays({ preset: "all", offset: 0 }, today)).toBeNull();
  });

  it("reads today in the user's timezone", () => {
    const instant = new Date("2026-10-01T02:00:00Z");
    expect(todayIso("America/Sao_Paulo", instant)).toBe("2026-09-30");
    expect(todayIso("UTC", instant)).toBe("2026-10-01");
    expect(currentMonth("America/Sao_Paulo", instant)).toEqual({ year: 2026, month: 9 });
  });
});
