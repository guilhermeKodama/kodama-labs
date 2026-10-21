import { describe, expect, it } from "vitest";
import { dayLabel, monthRange } from "@/lib/money";

describe("monthRange", () => {
  it("covers a 31-day month", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("covers a 30-day month", () => {
    expect(monthRange("2026-04").to).toBe("2026-04-30");
  });

  it("ends a non-leap February on the 28th", () => {
    expect(monthRange("2026-02").to).toBe("2026-02-28");
  });

  it("ends a leap February on the 29th", () => {
    expect(monthRange("2024-02").to).toBe("2024-02-29");
  });

  it("handles century years", () => {
    expect(monthRange("1900-02").to).toBe("1900-02-28");
    expect(monthRange("2000-02").to).toBe("2000-02-29");
  });

  it("handles December at the year boundary", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("starts on day 01 and pads the last day to 2 digits", () => {
    for (let month = 1; month <= 12; month += 1) {
      const { from, to } = monthRange(`2026-${String(month).padStart(2, "0")}`);
      expect(from.endsWith("-01")).toBe(true);
      expect(to.split("-")[2]).toHaveLength(2);
    }
  });
});

describe("dayLabel", () => {
  it("formats as dd/mm", () => {
    expect(dayLabel("2026-10-05")).toBe("05/10");
    expect(dayLabel("2026-12-31")).toBe("31/12");
  });

  it("keeps leading zeros", () => {
    expect(dayLabel("2026-01-01")).toBe("01/01");
  });

  it("ignores the year", () => {
    expect(dayLabel("1999-03-09")).toBe(dayLabel("2030-03-09"));
  });
});
