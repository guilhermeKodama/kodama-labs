import { describe, expect, it } from "vitest";
import { addDays, billJustClosed, inAlertHours, isoWeekKey, localNow, weeklySummaryWindow } from "../lib/schedule";

describe("notification schedule", () => {
  it("reads the user's local date, hour and weekday", () => {
    // 02:30 UTC on Monday 2026-10-05 is still Sunday evening in São Paulo (UTC−3).
    const now = new Date("2026-10-05T02:30:00Z");
    expect(localNow(now, "America/Sao_Paulo")).toEqual({ ymd: "2026-10-04", year: 2026, month: 10, day: 4, hour: 23, dow: 0 });
    expect(localNow(now, "Asia/Tokyo")).toMatchObject({ ymd: "2026-10-05", hour: 11, dow: 1 });
    expect(localNow(now, "Not/AZone")).toMatchObject({ ymd: "2026-10-05", hour: 2, dow: 1 });
  });

  it("moves calendar days and names ISO weeks", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoWeekKey("2026-10-05")).toBe("2026-W41");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
  });

  it("sends alerts only in the daytime window", () => {
    expect(inAlertHours({ hour: 8 })).toBe(false);
    expect(inAlertHours({ hour: 9 })).toBe(true);
    expect(inAlertHours({ hour: 21 })).toBe(true);
    expect(inAlertHours({ hour: 22 })).toBe(false);
  });

  it("covers the previous seven days on the chosen weekday from the chosen hour", () => {
    const monday8 = localNow(new Date("2026-10-05T11:00:00Z"), "America/Sao_Paulo");
    expect(weeklySummaryWindow(monday8, { dow: 1, hour: 8 })).toEqual({ from: "2026-09-28", to: "2026-10-04", key: "2026-W41" });
    expect(weeklySummaryWindow(monday8, { dow: 1, hour: 9 })).toBeNull();
    expect(weeklySummaryWindow(monday8, { dow: 2, hour: 8 })).toBeNull();
  });

  it("announces a statement during the three days after its closing day", () => {
    expect(billJustClosed("2026-10-05", "2026-10-05")).toBe(false);
    expect(billJustClosed("2026-10-05", "2026-10-06")).toBe(true);
    expect(billJustClosed("2026-10-05", "2026-10-08")).toBe(true);
    expect(billJustClosed("2026-10-05", "2026-10-09")).toBe(false);
  });
});
