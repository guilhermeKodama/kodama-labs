import type { GroupKey, LedgerFilter, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { diffViewConfig, draftPatch, type ViewDraft } from "./view-draft";

/**
 * Drill-down (mockup drill 2824–2834, lifecycle 3150–3163): a number in
 * the pivot or a chart opens the table with that slice, as a draft of the
 * view (never saved; "Limpar" drops it, "Salvar como nova" keeps it). The
 * slice replaces the view's own filters on the same properties, and the
 * table opens ungrouped. Time buckets drill with the inBuckets filter.
 */

/** One group value clicked: the key it is grouped by and the group's key (null = empty, e.g. Sem categoria). */
export interface DrillCell {
  key: GroupKey;
  value: string | null;
}

/** Separator of a neutral transfer's composite group key ("<from>→<to>"). */
export const COMPOSITE_SEPARATOR = "→";

/** The filters that select one group value. */
export function groupValueFilters(key: GroupKey, value: string | null): LedgerFilter[] {
  if ("bucket" in key) return value === null ? [] : [{ field: key.field, op: "inBuckets", bucket: key.bucket, values: [value] }];
  if (value === null) return [{ field: key.field, op: "in", values: [null] }];
  if ((key.field === "entityId" || key.field === "accountId") && value.includes(COMPOSITE_SEPARATOR)) {
    // A neutral transfer grouped as "from→to": both sides, transfers only.
    const sides = value.split(COMPOSITE_SEPARATOR).filter(Boolean);
    return [
      { field: key.field, op: "in", values: sides },
      { field: "flowKind", op: "in", values: ["transfer"] },
    ];
  }
  if (key.field === "isTaxDeductible" || key.field === "isRecurring") return [{ field: key.field, op: "in", values: [value === "true"] }];
  return [{ field: key.field, op: "in", values: [value] }];
}

/** The filters of "Outros" (every value but the shown ones); null when it cannot be expressed (a time axis). */
export function othersFilters(key: GroupKey, shown: readonly (string | null)[]): LedgerFilter[] | null {
  if ("bucket" in key || !shown.length) return null;
  const values = shown.map((v) => (v !== null && (key.field === "isTaxDeductible" || key.field === "isRecurring") ? v === "true" : v));
  return [{ field: key.field, op: "nin", values }];
}

/** Whether a filter narrows the same property a drill key sets (so the drill replaces it). */
function sameProperty(filter: LedgerFilter, key: GroupKey): boolean {
  if ("bucket" in key) return filter.op === "inBuckets" && filter.bucket === key.bucket;
  return filter.field === key.field;
}

/** The config of the drilled table: filters replaced per property, layout table, no grouping. */
export function drillConfig(config: ViewConfig, keys: readonly GroupKey[], filters: readonly LedgerFilter[]): ViewConfig {
  const kept = config.filters.filter((f) => !keys.some((key) => sameProperty(f, key)));
  return { ...config, layout: "table", groupBy: [], filters: [...kept, ...filters] };
}

/** The draft of a drill: the clicked cells over the view on screen (`applied`), as a patch of the saved config. */
export function drillDraft(saved: ViewConfig, applied: ViewConfig, cells: readonly DrillCell[]): ViewDraft {
  const filters = cells.flatMap((cell) => groupValueFilters(cell.key, cell.value));
  return diffViewConfig(saved, drillConfig(applied, cells.map((c) => c.key), filters));
}

/** The draft of a drill into "Outros" or any custom filter set. */
export function drillFiltersDraft(saved: ViewConfig, applied: ViewConfig, keys: readonly GroupKey[], filters: readonly LedgerFilter[]): ViewDraft {
  return diffViewConfig(saved, drillConfig(applied, keys, filters));
}

/** A calendar day: the table for that date (on the view's date field). */
export function dayDraft(saved: ViewConfig, applied: ViewConfig, day: string): ViewDraft {
  return drillDraft(saved, applied, [{ key: { field: applied.dateField, bucket: "day" }, value: day }]);
}

/**
 * A drill's draft with its banner ("Detalhe: {label} · voltar à view"):
 * the label names the slice, and `back` keeps the draft that was on
 * screen before the drill (temporary filters of Todas, an earlier
 * change), so going back restores it instead of dropping everything.
 */
export function withDrillBanner(draft: ViewDraft, label: string, previous: ViewDraft | null | undefined): ViewDraft {
  const back = draftPatch(previous);
  return { ...draft, label, ...(back ? { back } : {}) };
}
