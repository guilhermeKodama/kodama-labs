import { describe, expect, it } from "vitest";
import type { LedgerFilter } from "@capital/server/modules/ledger/contracts";
import { fieldChipKeys, ledgerChipKeys, propChipKey } from "@/lib/ledger/chip-keys";
import { setFieldChipValues, type FieldFilter } from "@/lib/ledger/field-filters";
import { removeFilterAt, setChipValues } from "@/lib/ledger/filters";

/** The chip being edited must stay the same element (editor open, anchored) while its filter is created, changed or moved. */
describe("filter chip keys", () => {
  const imported: LedgerFilter = { field: "importId", op: "in", values: ["imp"] };

  it("keeps a picked property's key once its first value creates the filter (ledger)", () => {
    const before: LedgerFilter[] = [imported];
    const pending = propChipKey("categoryId");
    const after = setChipValues(before, "categoryId", ["c1"]);
    expect(ledgerChipKeys(after).at(-1)).toBe(pending);
    expect(ledgerChipKeys(setChipValues(after, "categoryId", ["c1", "c2"])).at(-1)).toBe(pending);
  });

  it("keeps a chip's key when an earlier filter is removed (ledger)", () => {
    const filters = setChipValues(setChipValues([imported], "flowKind", ["out"]), "date:month", ["2026-09"]);
    const keys = ledgerChipKeys(filters);
    const moved = ledgerChipKeys(removeFilterAt(filters, 0));
    expect(moved).toEqual([keys[1], keys[2]]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys only the first filter on a property by it; the others by their place", () => {
    const filters: LedgerFilter[] = [
      { field: "flowKind", op: "in", values: ["out"] },
      { field: "flowKind", op: "in", values: ["in"] },
      { field: "entityId", op: "nin", values: ["e1"] },
    ];
    expect(ledgerChipKeys(filters)).toEqual([propChipKey("flowKind"), "1:flowKind:in", "2:entityId:nin"]);
  });

  it("does the same for Carteira's chips", () => {
    const older: FieldFilter = { field: "brokerId", op: "nin", values: ["b1"] };
    const after = setFieldChipValues([older], "assetClass", ["stock"]);
    expect(fieldChipKeys(after)).toEqual(["0:brokerId:nin", propChipKey("assetClass")]);
    expect(fieldChipKeys(after.slice(1))).toEqual([propChipKey("assetClass")]);
  });
});
