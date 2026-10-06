import { describe, expect, it } from "vitest";
import { boardQuery, bucketOptionsQuery, calendarQuery, chartKeys, chartQuery, flowsQuery, isPagedLayout, layoutQuery, pivotQuery, tableQuery, viewSelection } from "@/lib/ledger/view-query";
import { viewConfig } from "./fixtures";

const chart = (type: "bar" | "line" | "area" | "pie" | "waterfall" | "bar100", patch = {}) =>
  viewConfig({ layout: "chart", chart: { type, metric: "sum", cumulative: false, top: 0 }, ...patch });

describe("view queries", () => {
  it("selects with the view's period and filters and a trimmed transient search", () => {
    const config = viewConfig({ filters: [{ field: "flowKind", op: "in", values: ["out"] }] });
    expect(viewSelection(config, "  ifood ")).toEqual({ period: config.period, dateField: "date", filters: config.filters, search: "ifood", deleted: "exclude" });
    expect(viewSelection(config, "   ")).not.toHaveProperty("search");
  });

  it("queries the table in display mode with groups, calcs and pages", () => {
    const config = viewConfig({ groupBy: [{ field: "entityId" }, { field: "categoryId" }], calcs: { amountBase: "median" } });
    const q = tableQuery(config);
    expect(q).toMatchObject({ semantics: "display", includeRows: true, groupBy: config.groupBy, sort: config.sort, page: { limit: 200 } });
    expect(q.rowsScope).toBeUndefined();
    expect(q.aggregations).toContainEqual({ fn: "median", field: "amountBase" });
  });

  it("crosses the pivot over counted rows, Categoria × Entidade by default", () => {
    const q = pivotQuery(viewConfig({ layout: "pivot" }));
    expect(q).toMatchObject({ semantics: "display", rowsScope: "counted", includeRows: false, pivot: { rows: { field: "categoryId" }, cols: { field: "entityId" } } });
    expect(pivotQuery(viewConfig({ layout: "pivot", groupBy: [{ field: "date", bucket: "month" }] })).pivot).toMatchObject({ rows: { field: "date", bucket: "month" }, cols: { field: "entityId" } });
  });

  it("charts counted rows; the axis falls back to Data for line/area and Categoria otherwise", () => {
    expect(chartKeys(chart("line"))).toEqual({ axis: { field: "date", bucket: "day" }, series: null });
    expect(chartKeys(chart("pie"))).toEqual({ axis: { field: "categoryId" }, series: null });
    const series = chartQuery(chart("bar", { groupBy: [{ field: "date", bucket: "month" }, { field: "entityId" }] }));
    expect(series).toMatchObject({ rowsScope: "counted", includeRows: false, groupBy: [{ field: "date", bucket: "month" }, { field: "entityId" }] });
    // Séries only for the series types.
    expect(chartQuery(chart("waterfall", { groupBy: [{ field: "categoryId" }, { field: "entityId" }] })).groupBy).toEqual([{ field: "categoryId" }]);
  });

  it("pages the board by its column key and the calendar by day over counted rows", () => {
    expect(boardQuery(viewConfig({ layout: "board" }))).toMatchObject({ groupBy: [{ field: "categoryId" }], includeRows: true });
    expect(boardQuery(viewConfig({ layout: "board", groupBy: [{ field: "accountId" }] })).groupBy).toEqual([{ field: "accountId" }]);
    expect(calendarQuery(viewConfig({ layout: "calendar" }))).toMatchObject({ rowsScope: "counted", groupBy: [{ field: "date", bucket: "day" }], includeRows: true });
  });

  it("routes each layout and knows which ones page", () => {
    expect(layoutQuery(viewConfig({ layout: "pivot" })).pivot).toBeDefined();
    expect(isPagedLayout(viewConfig())).toBe(true);
    expect(isPagedLayout(viewConfig({ layout: "chart" }))).toBe(false);
    expect(flowsQuery(viewConfig(), "x")).toMatchObject({ search: "x", deleted: "exclude" });
  });

  it("lists the buckets of the period for the bucket filters, without totals", () => {
    const q = bucketOptionsQuery(viewConfig({ filters: [{ field: "flowKind", op: "in", values: ["out"] }] }), "month");
    expect(q).toMatchObject({ filters: [], skipTotals: true, includeRows: false, groupBy: [{ field: "date", bucket: "month" }] });
  });
});
