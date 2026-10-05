import { describe, expect, it } from "vitest";
import { compareMonths, daysInMonth, monthKey, monthOfDate, monthOptions, parseMonthKey, parseYear, shiftMonth, todayIn } from "../period";

describe("todayIn", () => {
  it("takes the day in the user's timezone, not UTC", () => {
    // 01:30 UTC on Oct 1 is still Sep 30 in São Paulo (UTC−3).
    const now = new Date("2026-10-01T01:30:00Z");
    expect(todayIn("America/Sao_Paulo", now)).toEqual({ year: 2026, month: 9, day: 30, iso: "2026-09-30" });
    expect(todayIn("UTC", now)).toEqual({ year: 2026, month: 10, day: 1, iso: "2026-10-01" });
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(todayIn(null, now).iso).toBe("2026-10-05");
    expect(todayIn("Not/AZone", now).iso).toBe("2026-10-05");
  });
});

describe("months", () => {
  it("formats and parses YYYY-MM", () => {
    expect(monthKey({ year: 2026, month: 9 })).toBe("2026-09");
    expect(parseMonthKey("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-9")).toBeNull();
    expect(parseMonthKey(null)).toBeNull();
    expect(parseYear("2026")).toBe(2026);
    expect(parseYear("20x6")).toBeNull();
    expect(monthOfDate("2026-09-22")).toEqual({ year: 2026, month: 9 });
  });

  it("shifts across years", () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 9 }, -21)).toEqual({ year: 2024, month: 12 });
    expect(compareMonths({ year: 2026, month: 1 }, { year: 2025, month: 12 })).toBeGreaterThan(0);
  });

  it("lists the months a version may start from, never before the budget starts", () => {
    const options = monthOptions({ year: 2026, month: 9 }, 2, 1);
    expect(options.map(monthKey)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(monthOptions({ year: 2026, month: 9 }, 2, 1, { year: 2026, month: 8 }).map(monthKey)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("counts days in a month", () => {
    expect(daysInMonth({ year: 2026, month: 9 })).toBe(30);
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
  });
});
