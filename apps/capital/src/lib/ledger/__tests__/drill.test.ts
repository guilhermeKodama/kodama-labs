import { describe, expect, it } from "vitest";
import { dayDraft, drillConfig, drillDraft, drillFiltersDraft, groupValueFilters, othersFilters } from "@/lib/ledger/drill";
import { applyViewDraft } from "@/lib/ledger/view-draft";
import { viewConfig } from "./fixtures";

describe("drill-down", () => {
  it("turns a group value into the filter that selects it", () => {
    expect(groupValueFilters({ field: "categoryId" }, "c1")).toEqual([{ field: "categoryId", op: "in", values: ["c1"] }]);
    expect(groupValueFilters({ field: "categoryId" }, null)).toEqual([{ field: "categoryId", op: "in", values: [null] }]);
    expect(groupValueFilters({ field: "isTaxDeductible" }, "true")).toEqual([{ field: "isTaxDeductible", op: "in", values: [true] }]);
    expect(groupValueFilters({ field: "date", bucket: "month" }, "2026-09")).toEqual([{ field: "date", op: "inBuckets", bucket: "month", values: ["2026-09"] }]);
    expect(groupValueFilters({ field: "date", bucket: "quarter" }, "2026-Q3")).toEqual([{ field: "date", op: "inBuckets", bucket: "quarter", values: ["2026-Q3"] }]);
  });

  it("drills a neutral transfer's from→to key into both sides, transfers only", () => {
    expect(groupValueFilters({ field: "entityId" }, "pj→pf")).toEqual([
      { field: "entityId", op: "in", values: ["pj", "pf"] },
      { field: "flowKind", op: "in", values: ["transfer"] },
    ]);
  });

  it("opens the table ungrouped, replacing the view's filters on the drilled properties", () => {
    const saved = viewConfig({
      layout: "pivot",
      groupBy: [{ field: "categoryId" }, { field: "entityId" }],
      filters: [
        { field: "entityId", op: "in", values: ["pj", "llc"] },
        { field: "flowKind", op: "in", values: ["out"] },
      ],
    });
    const draft = drillDraft(saved, saved, [
      { key: { field: "categoryId" }, value: "software" },
      { key: { field: "entityId" }, value: "llc" },
    ]);
    expect(draft.layout).toBe("table");
    expect(draft.groupBy).toEqual([]);
    expect(draft.filters).toEqual([
      { field: "flowKind", op: "in", values: ["out"] },
      { field: "categoryId", op: "in", values: ["software"] },
      { field: "entityId", op: "in", values: ["llc"] },
    ]);
    expect(applyViewDraft(saved, draft).period).toEqual(saved.period);
  });

  it("drills a pivot total with one side and the grand total with none", () => {
    const saved = viewConfig({ layout: "pivot" });
    expect(drillDraft(saved, saved, [{ key: { field: "entityId" }, value: "pf" }]).filters).toEqual([{ field: "entityId", op: "in", values: ["pf"] }]);
    expect(drillDraft(saved, saved, [])).toEqual({ layout: "table" });
  });

  it("drills a month bar of a time axis with inBuckets, keeping other bucket filters", () => {
    const saved = viewConfig({ layout: "chart", groupBy: [{ field: "date", bucket: "month" }], filters: [{ field: "date", op: "inBuckets", bucket: "year", values: ["2026"] }] });
    const config = drillConfig(saved, [{ field: "date", bucket: "month" }], groupValueFilters({ field: "date", bucket: "month" }, "2026-08"));
    expect(config.filters).toEqual([
      { field: "date", op: "inBuckets", bucket: "year", values: ["2026"] },
      { field: "date", op: "inBuckets", bucket: "month", values: ["2026-08"] },
    ]);
  });

  it("drills 'Outros' as every value but the ones shown; not on a time axis", () => {
    expect(othersFilters({ field: "categoryId" }, ["a", null])).toEqual([{ field: "categoryId", op: "nin", values: ["a", null] }]);
    expect(othersFilters({ field: "date", bucket: "month" }, ["2026-09"])).toBeNull();
    const saved = viewConfig({ layout: "chart" });
    expect(drillFiltersDraft(saved, saved, [{ field: "categoryId" }], othersFilters({ field: "categoryId" }, ["a"])!).filters).toEqual([{ field: "categoryId", op: "nin", values: ["a"] }]);
  });

  it("opens a calendar day in the table", () => {
    const saved = viewConfig({ layout: "calendar", filters: [{ field: "flowKind", op: "in", values: ["out"] }] });
    expect(dayDraft(saved, saved, "2026-09-22")).toEqual({
      layout: "table",
      filters: [
        { field: "flowKind", op: "in", values: ["out"] },
        { field: "date", op: "inBuckets", bucket: "day", values: ["2026-09-22"] },
      ],
    });
  });
});
