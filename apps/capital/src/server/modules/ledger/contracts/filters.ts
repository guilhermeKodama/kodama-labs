import { z } from "zod";
import { categoricalFieldSchema, dateFieldSchema, numericFieldSchema, TEXT_FIELDS, timeBucketSchema } from "./common";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ledgerFilterSchema = z.union([
  z.object({ field: categoricalFieldSchema, op: z.literal("in"), values: z.array(scalar).min(1) }),
  z.object({ field: categoricalFieldSchema, op: z.literal("nin"), values: z.array(scalar).min(1) }),
  z.object({ field: categoricalFieldSchema, op: z.literal("isNull") }),
  z.object({ field: categoricalFieldSchema, op: z.literal("isNotNull") }),
  z.object({ field: numericFieldSchema, op: z.enum(["gt", "gte", "lt", "lte", "eq"]), value: z.number() }),
  z.object({ field: numericFieldSchema, op: z.literal("between"), min: z.number(), max: z.number() }),
  z.object({ field: dateFieldSchema, op: z.literal("between"), from: z.string().date(), to: z.string().date() }),
  z.object({ field: z.enum(TEXT_FIELDS), op: z.literal("contains"), value: z.string().min(1) }),
  /**
   * The date falls in one of these buckets, keyed like the group keys of
   * the same bucket (see TIME_BUCKETS): the Semana/Mês/Trimestre/Ano
   * filters and every drill from a time axis ("2026-09", "2026-Q3",
   * "2026-09-W3").
   */
  z.object({
    field: dateFieldSchema,
    op: z.literal("inBuckets"),
    bucket: timeBucketSchema,
    values: z.array(z.string().min(1)).min(1).max(1000),
  }),
  /**
   * Spent to date through this day (YYYY-MM-DD, inclusive). Card purchases
   * count on their purchase date; every other expense on its effective date.
   * The period still selects the month (effective date), so a purchase whose
   * statement closes later in the month is included once it has been swiped.
   * See ledger/lib/spend-as-of.ts — the only implementation of this predicate.
   */
  z.object({
    field: z.literal("spentToDate"),
    op: z.literal("asOf"),
    asOf: z.string().date(),
  }),
]);
export type LedgerFilter = z.infer<typeof ledgerFilterSchema>;
