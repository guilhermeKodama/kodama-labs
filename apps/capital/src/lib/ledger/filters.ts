import type { DateField, LedgerFilter } from "@capital/server/modules/ledger/contracts";
import { bucketOf, isPropId, PROP_META, type PropId } from "./columns";

/**
 * Filter chips (mockup filterStyle=chips, 2234–2362): one chip per
 * property, "<Prop> é <v1>, <v2>" or "<Prop> é N valores", built on the
 * query's filters. A categorical property is {field, op: "in", values};
 * Semana/Mês/Trimestre/Ano are {field: "date", op: "inBuckets", bucket,
 * values} with the bucket keys ("2026-09", "2026-Q3", "2026-09-W3"), on
 * the view's date field (effectiveDate on a "Data de competência" view,
 * as a drill into a pivot or chart bucket of that view builds it).
 *
 * Values are handled as strings in the UI: booleans as "true"/"false",
 * and a null (Sem categoria) as NONE.
 */

export const NONE = "__none__";

const BOOLEAN_PROPS = new Set<string>(["isRecurring", "isTaxDeductible"]);

/** The property a filter is the chip of; null for filters the chips do not edit (from before the new UI). */
export function filterProp(filter: LedgerFilter): PropId | null {
  if (filter.op === "in" && isPropId(filter.field) && PROP_META[filter.field].groupable) return filter.field;
  if (filter.op === "inBuckets" && (filter.field === "date" || filter.field === "effectiveDate")) {
    const id = `date:${filter.bucket}`;
    return isPropId(id) ? id : null;
  }
  return null;
}

/** A chip's checked values, as strings. */
export function filterValues(filter: LedgerFilter): string[] {
  if (filter.op === "inBuckets") return [...filter.values];
  if (filter.op === "in" || filter.op === "nin") return filter.values.map((v) => (v === null ? NONE : String(v)));
  return [];
}

/** The filter of a property with these values (strings as in the UI). */
export function buildFilter(prop: PropId, values: readonly string[], dateField: DateField = "date"): LedgerFilter {
  const bucket = bucketOf(prop);
  if (bucket && bucket !== "day") return { field: dateField, op: "inBuckets", bucket, values: [...values] };
  const typed = values.map((v) => (v === NONE ? null : BOOLEAN_PROPS.has(prop) ? v === "true" : v));
  return { field: prop as Extract<LedgerFilter, { op: "in" }>["field"], op: "in", values: typed };
}

/** The index of a property's chip in the filter list, or -1. */
export function chipIndex(filters: readonly LedgerFilter[], prop: PropId): number {
  return filters.findIndex((f) => filterProp(f) === prop);
}

/**
 * Sets a property's values: replaces its chip in place, appends a new one,
 * or removes it when no value is left (the server needs at least one).
 * A date-bucket chip keeps the date it was on; a new one takes the view's.
 */
export function setChipValues(filters: readonly LedgerFilter[], prop: PropId, values: readonly string[], dateField: DateField = "date"): LedgerFilter[] {
  const index = chipIndex(filters, prop);
  if (!values.length) return index < 0 ? [...filters] : filters.filter((_, i) => i !== index);
  const current = index < 0 ? null : filters[index];
  const next = buildFilter(prop, values, current?.op === "inBuckets" ? current.field : dateField);
  if (index < 0) return [...filters, next];
  return filters.map((f, i) => (i === index ? next : f));
}

/** Removes the filter at `index` (the chip's ✕). */
export function removeFilterAt(filters: readonly LedgerFilter[], index: number): LedgerFilter[] {
  return filters.filter((_, i) => i !== index);
}

/** Properties "Filtrar por…" still offers: the groupable ones without a chip. */
export function addableProps(filters: readonly LedgerFilter[], groupable: readonly PropId[]): PropId[] {
  return groupable.filter((prop) => chipIndex(filters, prop) < 0);
}

/** How a chip reads: no values ("escolha…"), the values (up to 2) or a count. */
export type ChipText = { kind: "choose" } | { kind: "values"; values: string[] } | { kind: "count"; count: number };

export function chipText(labels: readonly string[]): ChipText {
  if (!labels.length) return { kind: "choose" };
  if (labels.length <= 2) return { kind: "values", values: [...labels] };
  return { kind: "count", count: labels.length };
}
