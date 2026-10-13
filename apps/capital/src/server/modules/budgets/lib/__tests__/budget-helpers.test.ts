import { describe, expect, it } from "vitest";
import { mean, slotKey, stillToCome, typical } from "../assign";
import { chainKey, normalizeToMonthStart, resolveEffective, yearMonth } from "../effective-budgets";
import { DAY_MS, todayIn } from "../today";

describe("normalizeToMonthStart", () => {
  it("goes to the first of the month at noon UTC", () => {
    expect(normalizeToMonthStart(new Date("2026-09-22T15:30:00Z")).toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });

  it("keeps a legacy 00:00 UTC first of the month in the same month", () => {
    expect(normalizeToMonthStart(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("keeps the last millisecond of a month in that month", () => {
    expect(normalizeToMonthStart(new Date("2026-12-31T23:59:59.999Z")).toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });
});

describe("yearMonth", () => {
  it("encodes year and 0-based month as one number", () => {
    expect(yearMonth(new Date("2026-09-15T12:00:00Z"))).toBe(202608);
    expect(yearMonth(new Date("2026-01-01T00:00:00Z"))).toBe(202600);
  });

  it("orders across years", () => {
    expect(yearMonth(new Date("2027-01-01T12:00:00Z"))).toBeGreaterThan(yearMonth(new Date("2026-12-01T12:00:00Z")));
  });
});

describe("chainKey and slotKey", () => {
  it("writes a null entity as *", () => {
    expect(chainKey({ entityId: null, categoryId: "c1", period: "monthly" })).toBe("*|c1|monthly");
    expect(chainKey({ entityId: "e1", categoryId: "c1", period: "yearly" })).toBe("e1|c1|yearly");
  });

  it("slotKey writes a null entity as * and a null category as -", () => {
    expect(slotKey(null, "c1")).toBe("*|c1");
    expect(slotKey("e1", null)).toBe("e1|-");
    expect(slotKey(null, null)).toBe("*|-");
  });
});

describe("empty series", () => {
  it("mean([]) is 0", () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
  });

  it("typical([]) is 0", () => {
    expect(typical([])).toBe(0);
  });

  it("stillToCome([], [], x) is 0 whatever was spent", () => {
    expect(stillToCome([], [], 0)).toBe(0);
    expect(stillToCome([], [], 500)).toBe(0);
  });
});

describe("todayIn", () => {
  it("gives the calendar date, its UTC bounds and the ISO string", () => {
    const t = todayIn("UTC", new Date("2026-09-22T15:00:00Z"));
    expect(t).toMatchObject({ y: 2026, m: 9, d: 22, iso: "2026-09-22" });
    expect(t.start.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(t.end.toISOString()).toBe("2026-09-22T23:59:59.999Z");
  });

  it("rolls the day back where it is still the day before", () => {
    const now = new Date("2026-09-22T02:00:00Z");
    expect(todayIn("UTC", now).iso).toBe("2026-09-22");
    expect(todayIn("America/Sao_Paulo", now).iso).toBe("2026-09-21");
  });

  it("rolls the day forward where it is already the next day", () => {
    const now = new Date("2026-09-22T20:00:00Z");
    expect(todayIn("America/Sao_Paulo", now).iso).toBe("2026-09-22");
    expect(todayIn("Asia/Tokyo", now).iso).toBe("2026-09-23");
  });

  it("crosses a month and year boundary by timezone", () => {
    const t = todayIn("Asia/Tokyo", new Date("2026-12-31T16:00:00Z"));
    expect(t).toMatchObject({ y: 2027, m: 1, d: 1, iso: "2027-01-01" });
  });
});

describe("DAY_MS", () => {
  it("is 24 hours in milliseconds", () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
    expect(todayIn("UTC", new Date("2026-09-22T00:00:00Z")).start.getTime() + DAY_MS).toBe(todayIn("UTC", new Date("2026-09-23T00:00:00Z")).start.getTime());
  });
});

describe("resolveEffective with a null entity", () => {
  const row = (id: string, entityId: string | null, from: string) => ({
    id,
    entityId,
    categoryId: "c1",
    period: "monthly" as const,
    effectiveFrom: new Date(`${from}-01T12:00:00Z`),
    isTombstone: false,
  });

  it("treats the all-entities chain and an entity's chain as distinct", () => {
    const rows = [row("all-jan", null, "2026-01"), row("pf-jun", "pf", "2026-06")];
    expect(resolveEffective(rows, new Date("2026-03-01T12:00:00Z")).map((b) => b.id)).toEqual(["all-jan"]);
    expect(resolveEffective(rows, new Date("2026-07-01T12:00:00Z")).map((b) => b.id).sort()).toEqual(["all-jan", "pf-jun"]);
  });

  it("does not let an entity's later version replace the all-entities one", () => {
    const rows = [row("all-jan", null, "2026-01"), row("pf-mar", "pf", "2026-03"), row("all-may", null, "2026-05")];
    expect(resolveEffective(rows, new Date("2026-06-01T12:00:00Z")).map((b) => b.id).sort()).toEqual(["all-may", "pf-mar"]);
  });
});
