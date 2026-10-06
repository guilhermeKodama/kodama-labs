import { describe, expect, it } from "vitest";
import { allVisibleSelected, applySelectionClick, moveFocus, selectionStats } from "@/lib/ledger/selection";

describe("selection", () => {
  const visual = ["a", "b", "c", "d", "e"];

  it("toggles one row, or the range from the last click in drawn order with shift", () => {
    expect([...applySelectionClick(new Set(), visual, null, { id: "b", on: true, shift: false })]).toEqual(["b"]);
    expect([...applySelectionClick(new Set(["b"]), visual, "b", { id: "d", on: true, shift: true })].sort()).toEqual(["b", "c", "d"]);
    expect([...applySelectionClick(new Set(["a", "b", "c", "d"]), visual, "d", { id: "b", on: false, shift: true })]).toEqual(["a"]);
    // A last row no longer drawn (collapsed) falls back to a single toggle.
    expect([...applySelectionClick(new Set(), visual, "zz", { id: "c", on: true, shift: true })]).toEqual(["c"]);
  });

  it("knows when every visible row is selected", () => {
    expect(allVisibleSelected(new Set(["a", "b"]), ["a", "b"])).toBe(true);
    expect(allVisibleSelected(new Set(["a"]), ["a", "b"])).toBe(false);
    expect(allVisibleSelected(new Set(), [])).toBe(false);
  });

  it("sums counted rows only (a neutral transfer moves no money)", () => {
    const stats = selectionStats([
      { counts: true, displayAmount: -100 },
      { counts: false, displayAmount: 15000 },
      { counts: true, displayAmount: 40 },
    ]);
    expect(stats).toEqual({ count: 3, sum: -60, avg: -30, min: -100, max: 40 });
    expect(selectionStats([])).toEqual({ count: 0, sum: 0, avg: 0, min: 0, max: 0 });
  });

  it("moves the keyboard focus within the drawn rows", () => {
    expect(moveFocus(visual, null, 1)).toBe("a");
    expect(moveFocus(visual, null, -1)).toBe("e");
    expect(moveFocus(visual, "e", 1)).toBe("e");
    expect(moveFocus(visual, "c", -1)).toBe("b");
    expect(moveFocus([], "c", 1)).toBeNull();
  });
});
