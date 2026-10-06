import { z } from "zod";
import { categoricalFieldSchema, dateFieldSchema, numericFieldSchema, periodSchema, textFieldSchema, timeBucketSchema, type TimeBucket } from "./common";
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
  /**
   * sum, avg, median, min and max need a numeric field. count and
   * countDistinct take any field: categorical, description or a date
   * (with `bucket`, distinct weeks, months...).
   */
  field: z.union([numericFieldSchema, categoricalFieldSchema, textFieldSchema, dateFieldSchema]).default("amountBase"),
  /** countDistinct of a date field by bucket, e.g. distinct months. */
  bucket: timeBucketSchema.optional(),
});
export type Aggregation = z.infer<typeof aggregationSchema>;

/** Key under which an aggregation's value is reported, e.g. "sum:amountBase" or "countDistinct:date:month". */
export function aggregationKey(agg: Pick<Aggregation, "fn" | "field"> & { bucket?: TimeBucket }): string {
  return agg.bucket ? `${agg.fn}:${agg.field}:${agg.bucket}` : `${agg.fn}:${agg.field}`;
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
  /** Matches the description, notes, merchant, and the category, account and entity names (a transfer also by its other leg's). */
  search: z.string().trim().max(200).optional(),
  /** "only" lists the trash. */
  deleted: z.enum(["exclude", "include", "only"]).default("exclude"),
});
export type LedgerSelectionQuery = z.infer<typeof ledgerSelectionQuerySchema>;

/**
 * How rows are counted.
 * - legs: one row per ledger entry (MCP, the assistant, the trash).
 * - display: what the UI shows. A transfer is one row: neutral (not
 *   counted, absolute amount) when both legs are selected, a signed in/out
 *   row when a filter keeps one leg (e.g. an entity filter). An aporte
 *   (investment_deposit/withdrawal) is one counted row, negative into the
 *   broker. Cash legs of broker buys/sells are uncounted rows; dividends
 *   and yields count. Counts, aggregations, groups, pivot and pages are all
 *   over display rows, so a page never splits a transfer.
 */
export const LEDGER_SEMANTICS = ["legs", "display"] as const;
export const ROWS_SCOPES = ["all", "counted"] as const;

export const ledgerQuerySchema = ledgerSelectionQuerySchema.extend({
  groupBy: z.array(groupKeySchema).max(2).default([]),
  aggregations: z.array(aggregationSchema).max(8).default([{ fn: "sum", field: "amountBase" }, { fn: "count", field: "amountBase" }]),
  sort: z.array(sortSchema).max(3).default([{ field: "date", dir: "desc" }]),
  pivot: pivotSchema.optional(),
  /** Set false to skip row fetching (aggregates/groups only). */
  includeRows: z.boolean().default(true),
  page: pageSchema.default({ limit: 100 }),
  semantics: z.enum(LEDGER_SEMANTICS).default("legs"),
  /** "counted" drops the uncounted display rows (neutral transfers, broker buy/sell legs): pivot, charts, calendar. */
  rowsScope: z.enum(ROWS_SCOPES).default("all"),
  /** Display mode only: skip totals and summary (they come back null), e.g. for the ⌘K search. */
  skipTotals: z.boolean().default(false),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
export type LedgerQueryInput = z.input<typeof ledgerQuerySchema>;
export type LedgerSemantics = (typeof LEDGER_SEMANTICS)[number];
