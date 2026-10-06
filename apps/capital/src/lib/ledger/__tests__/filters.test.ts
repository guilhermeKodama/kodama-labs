import { describe, expect, it } from "vitest";
import type { LedgerFilter } from "@capital/server/modules/ledger/contracts";
import { GROUPABLE } from "@/lib/ledger/columns";
import { addableProps, buildFilter, chipIndex, chipText, filterProp, filterValues, NONE, removeFilterAt, setChipValues } from "@/lib/ledger/filters";

describe("filter chips", () => {
  it("builds categorical, boolean, empty and bucket filters", () => {
    expect(buildFilter("entityId", ["e1", "e2"])).toEqual({ field: "entityId", op: "in", values: ["e1", "e2"] });
    expect(buildFilter("isRecurring", ["true"])).toEqual({ field: "isRecurring", op: "in", values: [true] });
    expect(buildFilter("categoryId", ["c1", NONE])).toEqual({ field: "categoryId", op: "in", values: ["c1", null] });
    expect(buildFilter("date:month", ["2026-08", "2026-09"])).toEqual({ field: "date", op: "inBuckets", bucket: "month", values: ["2026-08", "2026-09"] });
    expect(buildFilter("date:monthWeek", ["2026-09-W3"])).toEqual({ field: "date", op: "inBuckets", bucket: "monthWeek", values: ["2026-09-W3"] });
  });

  it("reads the values back as strings", () => {
    expect(filterValues({ field: "isTaxDeductible", op: "in", values: [true, false] })).toEqual(["true", "false"]);
    expect(filterValues({ field: "categoryId", op: "in", values: [null] })).toEqual([NONE]);
    expect(filterValues({ field: "date", op: "inBuckets", bucket: "year", values: ["2026"] })).toEqual(["2026"]);
  });

  it("knows which filters are chips and which only show", () => {
    expect(filterProp({ field: "flowKind", op: "in", values: ["out"] })).toBe("flowKind");
    expect(filterProp({ field: "date", op: "inBuckets", bucket: "quarter", values: ["2026-Q3"] })).toBe("date:quarter");
    expect(filterProp({ field: "importId", op: "in", values: ["imp"] })).toBeNull();
    expect(filterProp({ field: "entityId", op: "nin", values: ["e1"] })).toBeNull();
    expect(filterProp({ field: "date", op: "inBuckets", bucket: "day", values: ["2026-09-01"] })).toBeNull();
    expect(filterProp({ field: "amountBase", op: "lte", value: -100 })).toBeNull();
  });

  it("replaces a chip in place, appends a new one and drops one left without values", () => {
    const filters: LedgerFilter[] = [
      { field: "entityId", op: "in", values: ["e1"] },
      { field: "importId", op: "in", values: ["imp"] },
    ];
    expect(setChipValues(filters, "entityId", ["e1", "e2"])).toEqual([{ field: "entityId", op: "in", values: ["e1", "e2"] }, filters[1]]);
    expect(setChipValues(filters, "flowKind", ["out"])).toEqual([...filters, { field: "flowKind", op: "in", values: ["out"] }]);
    expect(setChipValues(filters, "entityId", [])).toEqual([filters[1]]);
    expect(setChipValues(filters, "currency", [])).toEqual(filters);
    expect(removeFilterAt(filters, 1)).toEqual([filters[0]]);
    expect(chipIndex(filters, "entityId")).toBe(0);
  });

  it("offers each property once", () => {
    const filters: LedgerFilter[] = [{ field: "entityId", op: "in", values: ["e1"] }, { field: "date", op: "inBuckets", bucket: "month", values: ["2026-09"] }];
    const addable = addableProps(filters, GROUPABLE);
    expect(addable).not.toContain("entityId");
    expect(addable).not.toContain("date:month");
    expect(addable).toContain("date:year");
  });

  it("reads 'é A, B' up to two values and 'N valores' beyond", () => {
    expect(chipText([])).toEqual({ kind: "choose" });
    expect(chipText(["PF", "Kodama LTDA"])).toEqual({ kind: "values", values: ["PF", "Kodama LTDA"] });
    expect(chipText(["a", "b", "c"])).toEqual({ kind: "count", count: 3 });
  });

  it("puts date-bucket chips on the view's date field and keeps the date of a drilled one", () => {
    expect(buildFilter("date:month", ["2026-09"], "effectiveDate")).toEqual({ field: "effectiveDate", op: "inBuckets", bucket: "month", values: ["2026-09"] });
    const drilled: LedgerFilter[] = [{ field: "effectiveDate", op: "inBuckets", bucket: "quarter", values: ["2026-Q3"] }];
    expect(filterProp(drilled[0]!)).toBe("date:quarter");
    expect(setChipValues(drilled, "date:quarter", ["2026-Q3", "2026-Q2"])).toEqual([{ field: "effectiveDate", op: "inBuckets", bucket: "quarter", values: ["2026-Q3", "2026-Q2"] }]);
    expect(setChipValues([], "date:year", ["2026"], "effectiveDate")).toEqual([{ field: "effectiveDate", op: "inBuckets", bucket: "year", values: ["2026"] }]);
  });
});
