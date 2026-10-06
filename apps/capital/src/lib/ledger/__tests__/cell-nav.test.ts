import { describe, expect, it } from "vitest";
import { nextEditableCell } from "@/lib/ledger/cell-nav";

describe("nextEditableCell", () => {
  const rows = ["a", "b", "c"];
  const columns = ["date", "description", "categoryId", "amountBase"];
  // Row b is a transfer: its category is read-only.
  const editable = (rowId: string, column: string) => !(rowId === "b" && column === "categoryId");

  it("moves Tab to the next cell, wrapping to the next row", () => {
    expect(nextEditableCell(rows, columns, { rowId: "a", column: "description" }, "next", editable)).toEqual({ rowId: "a", column: "categoryId" });
    expect(nextEditableCell(rows, columns, { rowId: "a", column: "amountBase" }, "next", editable)).toEqual({ rowId: "b", column: "date" });
  });

  it("skips read-only cells both ways", () => {
    expect(nextEditableCell(rows, columns, { rowId: "b", column: "description" }, "next", editable)).toEqual({ rowId: "b", column: "amountBase" });
    expect(nextEditableCell(rows, columns, { rowId: "b", column: "amountBase" }, "previous", editable)).toEqual({ rowId: "b", column: "description" });
    expect(nextEditableCell(rows, columns, { rowId: "a", column: "categoryId" }, "down", editable)).toEqual({ rowId: "c", column: "categoryId" });
  });

  it("stops at the table's edges and on unknown cells", () => {
    expect(nextEditableCell(rows, columns, { rowId: "a", column: "date" }, "previous", editable)).toBeNull();
    expect(nextEditableCell(rows, columns, { rowId: "c", column: "amountBase" }, "next", editable)).toBeNull();
    expect(nextEditableCell(rows, columns, { rowId: "c", column: "date" }, "down", editable)).toBeNull();
    expect(nextEditableCell(rows, columns, { rowId: "zz", column: "date" }, "next", editable)).toBeNull();
  });
});
