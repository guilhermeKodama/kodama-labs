import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatDateOnly,
  getMonthRange,
  getProjectedMonths,
  getUserCurrentMonth,
  getUserCurrentYear,
  getUserToday,
  parseLocalDate,
  toDateString,
  toNoonUTC,
} from "../date-utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("toNoonUTC", () => {
  it("moves any time of a UTC day to 12:00:00.000Z of that same day", () => {
    expect(toNoonUTC(new Date("2026-02-06T00:00:00.000Z")).toISOString()).toBe("2026-02-06T12:00:00.000Z");
    expect(toNoonUTC(new Date("2026-02-06T23:59:59.999Z")).toISOString()).toBe("2026-02-06T12:00:00.000Z");
  });

  it("does not mutate its argument", () => {
    const original = new Date("2026-02-06T03:04:05.678Z");
    toNoonUTC(original);
    expect(original.toISOString()).toBe("2026-02-06T03:04:05.678Z");
  });
});

describe("parseLocalDate", () => {
  it("reads a date-only string as noon UTC of that calendar day", () => {
    expect(parseLocalDate("2026-02-06").toISOString()).toBe("2026-02-06T12:00:00.000Z");
    expect(parseLocalDate("2024-02-29").toISOString()).toBe("2024-02-29T12:00:00.000Z");
  });

  it("normalizes an ISO datetime to noon UTC of its UTC day", () => {
    expect(parseLocalDate("2026-02-06T03:00:00.000Z").toISOString()).toBe("2026-02-06T12:00:00.000Z");
    // 23:30 at UTC-3 is already the next UTC day.
    expect(parseLocalDate("2026-02-06T23:30:00-03:00").toISOString()).toBe("2026-02-07T12:00:00.000Z");
  });

  it("gives an Invalid Date for text that is not a date", () => {
    expect(Number.isNaN(parseLocalDate("not-a-date").getTime())).toBe(true);
  });
});

describe("formatDateOnly / toDateString", () => {
  it("formats the UTC parts, zero-padded", () => {
    expect(formatDateOnly(new Date("2026-01-05T12:00:00.000Z"))).toBe("2026-01-05");
    expect(formatDateOnly(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12-31");
  });

  it("round-trips with parseLocalDate", () => {
    expect(formatDateOnly(parseLocalDate("2026-09-15"))).toBe("2026-09-15");
  });

  it("toDateString is the same function", () => {
    expect(toDateString).toBe(formatDateOnly);
  });
});

describe("user timezone helpers", () => {
  it("reads 'today' in the user's zone, which can be a different day than UTC", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T12:00:00.000Z"));

    // +14:00 is already January 1st 2027; -11:00 is still December 31st 2026.
    const ahead = getUserToday("Pacific/Kiritimati");
    expect([ahead.getFullYear(), ahead.getMonth() + 1, ahead.getDate()]).toEqual([2027, 1, 1]);
    const behind = getUserToday("Pacific/Pago_Pago");
    expect([behind.getFullYear(), behind.getMonth() + 1, behind.getDate()]).toEqual([2026, 12, 31]);
  });

  it("derives the current year and month (1-12) in that zone", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T12:00:00.000Z"));

    expect(getUserCurrentYear("Pacific/Kiritimati")).toBe(2027);
    expect(getUserCurrentMonth("Pacific/Kiritimati")).toBe(1);
    expect(getUserCurrentYear("America/Sao_Paulo")).toBe(2026);
    expect(getUserCurrentMonth("America/Sao_Paulo")).toBe(12);
  });
});

describe("getMonthRange", () => {
  const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

  it("spans the first to the last day of the month", () => {
    const { start, end } = getMonthRange(2026, 9);
    expect(parts(start)).toEqual([2026, 9, 1]);
    expect(parts(end)).toEqual([2026, 9, 30]);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("knows February in leap and common years, and 31-day months", () => {
    expect(parts(getMonthRange(2028, 2).end)).toEqual([2028, 2, 29]);
    expect(parts(getMonthRange(2027, 2).end)).toEqual([2027, 2, 28]);
    expect(parts(getMonthRange(2026, 12).end)).toEqual([2026, 12, 31]);
  });
});

describe("getProjectedMonths", () => {
  it("lists the next N months after the anchor, crossing the year", () => {
    const projected = getProjectedMonths(new Date(2026, 10, 15, 12), 3);
    expect(projected.map((p) => [p.year, p.month])).toEqual([
      [2026, 12],
      [2027, 1],
      [2027, 2],
    ]);
    expect(projected.map((p) => p.date.getDate())).toEqual([15, 15, 15]);
  });

  it("clamps the day to the end of a shorter month", () => {
    const projected = getProjectedMonths(new Date(2026, 0, 31, 12), 2);
    expect(projected.map((p) => [p.month, p.date.getDate()])).toEqual([
      [2, 28],
      [3, 31],
    ]);
  });

  it("is empty for a count of zero", () => {
    expect(getProjectedMonths(new Date(2026, 0, 1, 12), 0)).toEqual([]);
  });
});
