import { describe, expect, it } from "vitest";
import { boardCards, boardColumnLimit, boardColumnOf, boardRemaining } from "@/lib/ledger/board";
import { calendarDays, dayIso, dayShade, monthGrid, outsideCount, rowsByDay } from "@/lib/ledger/calendar";
import { group } from "./fixtures";

const row = (id: string, key: string | null | undefined, date = "2026-09-01", effectiveDate = date) => ({ id, groupKeys: key === undefined ? undefined : [key], date, effectiveDate });

describe("board columns", () => {
  it("places each card in the column the server keyed it in, for any bucket and the transfer key", () => {
    const rows = [row("a", "2026-09-W1"), row("b", "2026-Q3"), row("c", null), row("d", "pj→pf"), row("e", undefined), row("f", "2026-09-W1")];
    expect(boardCards("2026-09-W1", rows).map((r) => r.id)).toEqual(["a", "f"]);
    expect(boardCards("2026-Q3", rows).map((r) => r.id)).toEqual(["b"]);
    expect(boardCards("pj→pf", rows).map((r) => r.id)).toEqual(["d"]);
    // No key = the empty column.
    expect(boardCards(null, rows).map((r) => r.id)).toEqual(["c", "e"]);
    expect(boardColumnOf(row("x", "true"))).toBe("true");
  });

  it("merges a column's own pages with the view's first page, without repeats or other columns", () => {
    const view = [row("a", "food"), row("b", "food"), row("z", "rent")];
    const column = [row("a", "food"), row("b", "food"), row("c", "food"), row("y", "rent")];
    expect(boardCards("food", view, column).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("counts what is left in a column and sizes its first page past what it shows", () => {
    expect(boardRemaining({ count: 30 }, 12)).toBe(18);
    expect(boardRemaining({ count: 3 }, 5)).toBe(0);
    expect(boardColumnLimit(0)).toBe(100);
    expect(boardColumnLimit(120)).toBe(220);
    expect(boardColumnLimit(480)).toBe(500);
  });
});

describe("calendar", () => {
  it("lays the month out Monday first, in whole weeks", () => {
    // Sep 2026 starts on a Tuesday; Feb 2026 on a Sunday; Jun 2026 on a Monday.
    expect(monthGrid("2026-09")).toEqual({ days: 30, lead: 1, cells: 35 });
    expect(monthGrid("2026-02")).toEqual({ days: 28, lead: 6, cells: 35 });
    expect(monthGrid("2026-06")).toEqual({ days: 30, lead: 0, cells: 35 });
    expect(monthGrid("2024-02").days).toBe(29);
    expect(dayIso("2026-09", 3)).toBe("2026-09-03");
  });

  it("shades days in three tiers by |Σ|", () => {
    expect([0, 1, -500, 501, -3000, 3001].map(dayShade)).toEqual([0, 4, 4, 3, 3, 2]);
  });

  it("takes net day totals from the month's groups and counts the rest of the period as other months", () => {
    const groups = [group("2026-08-31", -50, 2), group("2026-09-01", -120, 3), group("2026-09-15", 2000, 1), group(null, 0, 0)];
    const days = calendarDays(groups, "2026-09");
    expect([...days.entries()]).toEqual([
      ["2026-09-01", { total: -120, count: 3 }],
      ["2026-09-15", { total: 2000, count: 1 }],
    ]);
    expect(outsideCount(days, 6)).toBe(2);
    expect(outsideCount(days, 3)).toBe(0);
  });

  it("puts rows on their day by the view's date field, keeping their order", () => {
    const rows = [row("big", "x", "2026-09-01", "2026-10-05"), row("small", "x", "2026-09-01", "2026-10-05"), row("other", "x", "2026-09-02", "2026-10-05")];
    expect(rowsByDay(rows, "date").get("2026-09-01")?.map((r) => r.id)).toEqual(["big", "small"]);
    expect(rowsByDay(rows, "effectiveDate").get("2026-10-05")?.map((r) => r.id)).toEqual(["big", "small", "other"]);
  });
});
