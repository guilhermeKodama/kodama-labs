/**
 * Chip filters of the simple datasets (Carteira's positions and
 * operations): `{ field, op: "in" | "nin", values }`. One chip edits the
 * `in` filter of a field (the property → values → Pronto editor of
 * ChipBar); a `nin` filter (from older views) shows with its ✕ only.
 */

export interface FieldFilter<F extends string = string> {
  field: F;
  op: "in" | "nin";
  values: string[];
}

/** The `in` filter a field's chip edits, or -1. */
export function fieldChipIndex<T extends FieldFilter>(filters: readonly T[], field: T["field"]): number {
  return filters.findIndex((filter) => filter.field === field && filter.op === "in");
}

/** The values checked in a field's chip. */
export function fieldChipValues<T extends FieldFilter>(filters: readonly T[], field: T["field"]): string[] {
  const index = fieldChipIndex(filters, field);
  return index < 0 ? [] : [...filters[index].values];
}

/**
 * The filters with the field's chip set to `values`: the `in` filter is
 * created at the end, changed in place, or removed when nothing is left
 * checked.
 */
export function setFieldChipValues<T extends FieldFilter>(filters: readonly T[], field: T["field"], values: readonly string[]): T[] {
  const index = fieldChipIndex(filters, field);
  const unique = [...new Set(values)];
  if (index < 0) return unique.length ? [...filters, { field, op: "in", values: unique } as T] : [...filters];
  if (!unique.length) return filters.filter((_, i) => i !== index);
  return filters.map((filter, i) => (i === index ? { ...filter, values: unique } : filter));
}

/** Fields "+ Filtro" still offers (those without a chip). */
export function addableFields<T extends FieldFilter>(filters: readonly T[], fields: readonly T["field"][]): T["field"][] {
  return fields.filter((field) => fieldChipIndex(filters, field) < 0);
}
