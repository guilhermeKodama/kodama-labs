import { describe, expect, it } from "vitest";
import type { RecurrenceFrequency } from "@/generated/prisma";
import { getNextOccurrence } from "../recurrence";

const next = (iso: string, frequency: RecurrenceFrequency) => getNextOccurrence(new Date(iso), frequency).toISOString();

describe("getNextOccurrence", () => {
  it("adds one day, one week, one month or one year", () => {
    expect(next("2026-05-10T12:00:00.000Z", "daily")).toBe("2026-05-11T12:00:00.000Z");
    expect(next("2026-05-10T12:00:00.000Z", "weekly")).toBe("2026-05-17T12:00:00.000Z");
    expect(next("2026-05-10T12:00:00.000Z", "monthly")).toBe("2026-06-10T12:00:00.000Z");
    expect(next("2026-05-10T12:00:00.000Z", "yearly")).toBe("2027-05-10T12:00:00.000Z");
  });

  it("normalizes the input to noon UTC first, whatever time of day it carries", () => {
    expect(next("2026-05-10T00:30:00.000Z", "daily")).toBe("2026-05-11T12:00:00.000Z");
    expect(next("2026-05-10T23:59:59.000Z", "monthly")).toBe("2026-06-10T12:00:00.000Z");
  });

  it("clamps to the end of a shorter month and handles a leap day", () => {
    expect(next("2026-01-31T12:00:00.000Z", "monthly")).toBe("2026-02-28T12:00:00.000Z");
    expect(next("2028-01-31T12:00:00.000Z", "monthly")).toBe("2028-02-29T12:00:00.000Z");
    expect(next("2028-02-29T12:00:00.000Z", "yearly")).toBe("2029-02-28T12:00:00.000Z");
  });

  it("crosses a year boundary", () => {
    expect(next("2026-12-31T12:00:00.000Z", "daily")).toBe("2027-01-01T12:00:00.000Z");
    expect(next("2026-12-15T12:00:00.000Z", "monthly")).toBe("2027-01-15T12:00:00.000Z");
  });

  it("treats a frequency it does not know as monthly", () => {
    expect(next("2026-05-10T12:00:00.000Z", "fortnightly" as RecurrenceFrequency)).toBe("2026-06-10T12:00:00.000Z");
  });

  it("does not mutate the date it was given", () => {
    const current = new Date("2026-05-10T03:00:00.000Z");
    getNextOccurrence(current, "weekly");
    expect(current.toISOString()).toBe("2026-05-10T03:00:00.000Z");
  });
});
