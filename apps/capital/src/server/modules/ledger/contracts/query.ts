import { z } from "zod";
import { categoricalFieldSchema, dateFieldSchema, numericFieldSchema, periodSchema, timeBucketSchema } from "./common";
import { ledgerFilterSchema } from "./filters";

// ---------------------------------------------------------------------------
// Grouping, aggregation, sort, pivot, paging
// ---------------------------------------------------------------------------

export const groupKeySchema = z.union([
  z.object({ field: categoricalFieldSchema }),
  z.object({ field: dateFieldSchema, bucket: timeBucketSchema }),
]);
export type GroupKey = z.infer<typeof groupKeySchema>;

export const AGG_FNS = ["sum", "avg", "median", "min", "max", "count", "countDistinct"] as const;

export const aggregationSchema = z.object({
  fn: z.enum(AGG_FNS),
  field: z.union([numericFieldSchema, categoricalFieldSchema]).default("amountBase"),
});
export type Aggregation = z.infer<typeof aggregationSchema>;

/** Key under which an aggregation's value is reported, e.g. "sum:amountBase". */
export function aggregationKey(agg: Pick<Aggregation, "fn" | "field">): string {
  return `${agg.fn}:${agg.field}`;
}

export const SORT_FIELDS = ["date", "effectiveDate", "amount", "amountBase", "absAmountBase", "description", "createdAt"] as const;

export const sortSchema = z.object({
  field: z.enum(SORT_FIELDS),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export type LedgerSort = z.infer<typeof sortSchema>;

export const pivotSchema = z.object({
  rows: groupKeySchema,
  cols: groupKeySchema,
  measure: aggregationSchema.default({ fn: "sum", field: "amountBase" }),
});
export type Pivot = z.infer<typeof pivotSchema>;

export const pageSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

/** The part of a query that selects rows. Reused by bulk "select all in view". */
export const ledgerSelectionQuerySchema = z.object({
  period: periodSchema.default({ preset: "all", offset: 0 }),
  dateField: dateFieldSchema.default("date"),
  filters: z.array(ledgerFilterSchema).default([]),
  search: z.string().trim().max(200).optional(),
  /** "only" lists the trash. */
  deleted: z.enum(["exclude", "include", "only"]).default("exclude"),
});
export type LedgerSelectionQuery = z.infer<typeof ledgerSelectionQuerySchema>;

export const ledgerQuerySchema = ledgerSelectionQuerySchema.extend({
  groupBy: z.array(groupKeySchema).max(2).default([]),
  aggregations: z.array(aggregationSchema).max(8).default([{ fn: "sum", field: "amountBase" }, { fn: "count", field: "amountBase" }]),
  sort: z.array(sortSchema).max(3).default([{ field: "date", dir: "desc" }]),
  pivot: pivotSchema.optional(),
  /** Set false to skip row fetching (aggregates/groups only). */
  includeRows: z.boolean().default(true),
  page: pageSchema.default({ limit: 100 }),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
export type LedgerQueryInput = z.input<typeof ledgerQuerySchema>;
