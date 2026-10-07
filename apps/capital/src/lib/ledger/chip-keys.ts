import type { LedgerFilter } from "@capital/server/modules/ledger/contracts";
import { fieldChipIndex, type FieldFilter } from "./field-filters";
import { chipIndex, filterProp } from "./filters";

/**
 * React keys of the filter chips (ChipBar). The chip that edits a
 * property is keyed by the property, so it is the same element before its
 * filter exists ("Prop: escolha…", editor open), once the first value is
 * checked, and when an earlier filter is removed: its editor stays open
 * and anchored. Any other filter (one the chips cannot edit) is keyed by
 * its place.
 */

/** The key of the chip that edits `prop` (also while it is only picked, with no filter yet). */
export function propChipKey(prop: string): string {
  return `prop:${prop}`;
}

/** Keys of a ledger view's chips, in the order of its filters. */
export function ledgerChipKeys(filters: readonly LedgerFilter[]): string[] {
  return filters.map((filter, index) => {
    const prop = filterProp(filter);
    return prop !== null && chipIndex(filters, prop) === index ? propChipKey(prop) : `${index}:${filter.field}:${filter.op}`;
  });
}

/** Keys of a Carteira view's chips (positions, operations), in the order of its filters. */
export function fieldChipKeys(filters: readonly FieldFilter[]): string[] {
  return filters.map((filter, index) => (fieldChipIndex(filters, filter.field) === index ? propChipKey(filter.field) : `${index}:${filter.field}:${filter.op}`));
}
