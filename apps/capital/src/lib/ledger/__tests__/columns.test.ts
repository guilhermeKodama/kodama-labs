import { describe, expect, it } from "vitest";
import type { ViewConfig } from "@capital/server/modules/ledger/contracts";
import {
  BASE_COLUMNS,
  bucketKeyOf,
  calcAggregation,
  calcOf,
  displayFields,
  gridTemplate,
  groupByOf,
  groupIdOf,
  groupKeyOf,
  groupLabelKey,
  groupOptions,
  nextCalc,
  normalizeLedgerConfig,
  sortIdOf,
  tableAggregations,
  toggleColumn,
  visibleColumns,
} from "@/lib/ledger/columns";
import { viewConfig } from "./fixtures";

describe("properties", () => {
  it("lists the columns in the mockup's order whatever order they were stored in", () => {
    expect(visibleColumns({ columns: ["amountBase", "date", "nope", "date:month", "description"] })).toEqual(["date", "description", "date:month", "amountBase"]);
  });

  it("toggles a column and keeps PROP_ORDER", () => {
    expect(toggleColumn(BASE_COLUMNS, "flowKind")).toEqual(["date", "description", "entityId", "accountId", "categoryId", "flowKind", "amountBase"]);
    expect(toggleColumn(BASE_COLUMNS, "amountBase")).toEqual(["date", "description", "entityId", "accountId", "categoryId"]);
  });

  it("builds the grid with the checkbox and the ⋯ column around the mockup widths", () => {
    expect(gridTemplate(["date", "description", "isTaxDeductible", "amountBase"])).toBe("28px 52px minmax(0, 2.2fr) 86px 150px 28px");
  });

  it("keys dates by bucket like the server", () => {
    expect(bucketKeyOf("2026-09-22", "monthWeek")).toBe("2026-09-W4");
    expect(bucketKeyOf("2026-09-07", "monthWeek")).toBe("2026-09-W1");
    expect(bucketKeyOf("2026-09-08", "monthWeek")).toBe("2026-09-W2");
    expect(bucketKeyOf("2026-09-22", "month")).toBe("2026-09");
    expect(bucketKeyOf("2026-09-22", "quarter")).toBe("2026-Q3");
    expect(bucketKeyOf("2026-01-02", "quarter")).toBe("2026-Q1");
    expect(bucketKeyOf("2026-09-22", "year")).toBe("2026");
  });
});

describe("groups", () => {
  it("offers Data (dia) only on charts", () => {
    expect(groupOptions("table")).toEqual(["none", "entityId", "accountId", "categoryId", "flowKind", "currency", "isRecurring", "isTaxDeductible", "date:monthWeek", "date:month", "date:quarter", "date:year"]);
    expect(groupOptions("chart").slice(0, 2)).toEqual(["none", "date:day"]);
  });

  it("round-trips group ids and keys", () => {
    expect(groupKeyOf("date:month")).toEqual({ field: "date", bucket: "month" });
    expect(groupKeyOf("flowKind")).toEqual({ field: "flowKind" });
    expect(groupKeyOf("none")).toBeNull();
    expect(groupIdOf({ field: "date", bucket: "quarter" })).toBe("date:quarter");
    expect(groupIdOf(undefined)).toBe("none");
    expect(groupLabelKey("date:day")).toBe("day");
    expect(groupLabelKey("date:monthWeek")).toBe("week");
  });

  it("keeps a sub-group only with a group, using the layout's default rows or axis", () => {
    expect(groupByOf("table", "bar", "categoryId", "date:month")).toEqual([{ field: "categoryId" }, { field: "date", bucket: "month" }]);
    expect(groupByOf("table", "bar", "none", "none")).toEqual([]);
    expect(groupByOf("table", "bar", "none", "entityId")).toEqual([{ field: "entityId" }]);
    expect(groupByOf("pivot", "bar", "none", "date:month")).toEqual([{ field: "categoryId" }, { field: "date", bucket: "month" }]);
    expect(groupByOf("chart", "area", "none", "entityId")).toEqual([{ field: "date", bucket: "day" }, { field: "entityId" }]);
  });
});

describe("footer calcs", () => {
  it("cycles Valor through sum, avg, median, min, max, count, none and other columns through none, count, unique", () => {
    const cycle: string[] = [];
    let calc: string = "sum";
    for (let i = 0; i < 7; i++) cycle.push((calc = nextCalc("amountBase", calc)));
    expect(cycle).toEqual(["avg", "median", "min", "max", "count", "none", "sum"]);
    expect(nextCalc("description", undefined)).toBe("count");
    expect(nextCalc("description", "count")).toBe("countDistinct");
    expect(nextCalc("description", "countDistinct")).toBe("none");
  });

  it("reads a calc that does not fit the column as none", () => {
    expect(calcOf({ calcs: { description: "sum" } }, "description")).toBe("none");
    expect(calcOf({ calcs: {} }, "amountBase")).toBe("none");
  });

  it("maps calcs to query aggregations, unique on buckets by bucket", () => {
    expect(calcAggregation("amountBase", "median")).toEqual({ fn: "median", field: "amountBase" });
    expect(calcAggregation("description", "count")).toEqual({ fn: "count", field: "amountBase" });
    expect(calcAggregation("description", "countDistinct")).toEqual({ fn: "countDistinct", field: "description" });
    expect(calcAggregation("date:month", "countDistinct")).toEqual({ fn: "countDistinct", field: "date", bucket: "month" });
    expect(calcAggregation("flowKind", "none")).toBeNull();
  });

  it("asks for the subtotal, the count and each visible column's calc once", () => {
    const config = viewConfig({ columns: ["date", "description", "entityId", "date:month", "amountBase"], calcs: { amountBase: "avg", description: "count", entityId: "countDistinct", "date:month": "countDistinct", categoryId: "count" } });
    expect(tableAggregations(config)).toEqual([
      { fn: "sum", field: "amountBase" },
      { fn: "count", field: "amountBase" },
      { fn: "countDistinct", field: "entityId" },
      { fn: "countDistinct", field: "date", bucket: "month" },
      { fn: "avg", field: "amountBase" },
    ]);
  });
});

describe("sorts and Exibição fields", () => {
  it("knows the mockup's three sorts", () => {
    expect(sortIdOf([{ field: "date", dir: "desc" }])).toBe("date_desc");
    expect(sortIdOf([{ field: "date", dir: "asc" }])).toBe("date_asc");
    expect(sortIdOf([{ field: "absAmountBase", dir: "desc" }])).toBe("abs_desc");
    expect(sortIdOf([{ field: "description", dir: "asc" }])).toBeNull();
  });

  it("shows each control only where it has an effect", () => {
    const chart = (type: ViewConfig["chart"]["type"]) =>
      displayFields(viewConfig({ layout: "chart", chart: { type, metric: "sum", cumulative: false, top: 0 } }));
    expect(chart("waterfall")).toMatchObject({ metric: false, top: true, cumulative: false, sub: false });
    expect(chart("line")).toMatchObject({ metric: true, top: false, cumulative: true, sub: true });
    expect(chart("pie")).toMatchObject({ top: true, cumulative: false, sub: false });
    expect(chart("sankey")).toMatchObject({ group: false, metric: false, top: false, sub: false });
    expect(displayFields(viewConfig({ layout: "calendar" }))).toMatchObject({ group: false, sort: false, props: false });
    expect(displayFields(viewConfig({ layout: "board" }))).toMatchObject({ group: true, sub: false, sort: true, props: true });
  });
});

describe("configs from before the new UI", () => {
  it("turns the ledger kind into the derived Tipo", () => {
    const old = viewConfig({
      columns: ["amountBase", "kind", "date"],
      groupBy: [{ field: "kind" }],
      filters: [{ field: "kind", op: "in", values: ["expense", "investment"] }],
      calcs: { kind: "count" },
    });
    const next = normalizeLedgerConfig(old);
    expect(next.columns).toEqual(["date", "flowKind", "amountBase"]);
    expect(next.groupBy).toEqual([{ field: "flowKind" }]);
    expect(next.filters).toEqual([{ field: "flowKind", op: "in", values: ["out", "invest"] }]);
    expect(next.calcs).toEqual({ flowKind: "count" });
  });
});
