import { z } from "zod";

/**
 * Wire contracts for the v2 ledger API. Shared by the Hono routes, the
 * query engine, and the RPC client, so the UI and the server agree on one
 * vocabulary for filters, grouping, aggregation, views and bulk selection.
 */

export const LEDGER_KINDS = ["income", "expense", "transfer", "investment"] as const;
export const ACCOUNT_TYPES = ["checking", "credit_card", "brokerage", "cash"] as const;
export const TRANSFER_DIRECTIONS = [
  "profit_distribution",
  "capital_injection",
  "reimbursement",
  "investment_deposit",
  "investment_withdrawal",
  "card_payment",
  "between_accounts",
] as const;

export const ledgerKindSchema = z.enum(LEDGER_KINDS);
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const transferDirectionSchema = z.enum(TRANSFER_DIRECTIONS);

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** Categorical fields: filterable with equality/set operators and groupable. */
export const CATEGORICAL_FIELDS = [
  "entityId",
  "accountId",
  "accountType",
  "categoryId",
  "kind",
  "currency",
  "isTaxDeductible",
  "isRecurring",
  "transferDirection",
  "cardStatementId",
  "importId",
] as const;

export const NUMERIC_FIELDS = ["amount", "amountBase"] as const;
export const DATE_FIELDS = ["date", "effectiveDate"] as const;
export const TEXT_FIELDS = ["description"] as const;
export const TIME_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;

export const categoricalFieldSchema = z.enum(CATEGORICAL_FIELDS);
export const numericFieldSchema = z.enum(NUMERIC_FIELDS);
export const dateFieldSchema = z.enum(DATE_FIELDS);
export const timeBucketSchema = z.enum(TIME_BUCKETS);

export type CategoricalField = z.infer<typeof categoricalFieldSchema>;
export type NumericField = z.infer<typeof numericFieldSchema>;
export type DateField = z.infer<typeof dateFieldSchema>;
export type TimeBucket = z.infer<typeof timeBucketSchema>;

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

export const PERIOD_PRESETS = ["this_month", "last_month", "last_3m", "ytd", "last_12m", "all"] as const;

export const periodSchema = z.union([
  z.object({
    preset: z.enum(PERIOD_PRESETS),
    /** Steps back (negative) or forward from the current period, in units of the preset's length. */
    offset: z.number().int().min(-240).max(0).default(0),
  }),
  z.object({
    from: z.string().date(),
    to: z.string().date(),
  }),
]);
export type Period = z.infer<typeof periodSchema>;

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
]);
export type LedgerFilter = z.infer<typeof ledgerFilterSchema>;

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

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const ledgerRowSchema = z.object({
  id: z.string(),
  date: z.string(),
  effectiveDate: z.string(),
  description: z.string(),
  notes: z.string().nullable(),
  kind: ledgerKindSchema,
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  amountBase: z.number(),
  entityId: z.string(),
  accountId: z.string(),
  accountType: accountTypeSchema,
  categoryId: z.string().nullable(),
  isTaxDeductible: z.boolean(),
  isRecurring: z.boolean(),
  transferGroupId: z.string().nullable(),
  transferDirection: transferDirectionSchema.nullable(),
  counterpartAccountId: z.string().nullable(),
  cardStatementId: z.string().nullable(),
  installmentPlanId: z.string().nullable(),
  installmentNumber: z.number().nullable(),
  recurringRuleId: z.string().nullable(),
  importId: z.string().nullable(),
  deletedAt: z.string().nullable(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

const aggValues = z.record(z.string(), z.number().nullable());

export const ledgerGroupSchema: z.ZodType<LedgerGroup> = z.lazy(() =>
  z.object({
    key: z.string().nullable(),
    count: z.number(),
    values: aggValues,
    children: z.array(ledgerGroupSchema).optional(),
  })
);
export interface LedgerGroup {
  key: string | null;
  count: number;
  values: Record<string, number | null>;
  children?: LedgerGroup[];
}

export const ledgerQueryResultSchema = z.object({
  rows: z.array(ledgerRowSchema),
  groups: z.array(ledgerGroupSchema),
  totals: z.object({ count: z.number(), values: aggValues }),
  pivot: z
    .object({
      rowKeys: z.array(z.string().nullable()),
      colKeys: z.array(z.string().nullable()),
      cells: z.array(z.array(z.number().nullable())),
      rowTotals: z.array(z.number().nullable()),
      colTotals: z.array(z.number().nullable()),
      grandTotal: z.number().nullable(),
    })
    .optional(),
  range: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  pageInfo: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});
export type LedgerQueryResult = z.infer<typeof ledgerQueryResultSchema>;

/** Key under which an aggregation's value is reported, e.g. "sum:amountBase". */
export function aggregationKey(agg: Pick<Aggregation, "fn" | "field">): string {
  return `${agg.fn}:${agg.field}`;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const money = z.number().finite();
const isoDate = z.string().date();

const commonEntryFields = {
  description: z.string().min(1).max(500),
  notes: z.string().max(5000).nullish(),
  date: isoDate,
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
};

export const createEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["income", "expense"]),
    accountId: z.string(),
    /** Positive number; the sign comes from `kind` (expense = outflow). Negative expense = refund. */
    amount: money,
    categoryId: z.string().nullish(),
    isTaxDeductible: z.boolean().optional(),
    installments: z.number().int().min(2).max(72).optional(),
    externalId: z.string().max(200).optional(),
    ...commonEntryFields,
  }),
  z.object({
    kind: z.literal("transfer"),
    fromAccountId: z.string(),
    toAccountId: z.string(),
    amount: money.positive(),
    /** Amount credited when the accounts use different currencies. Defaults to amount * exchangeRate. */
    toAmount: money.positive().optional(),
    direction: transferDirectionSchema.optional(),
    ...commonEntryFields,
    description: z.string().min(1).max(500).optional(),
  }),
]);
export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const entryPatchSchema = z
  .object({
    description: z.string().min(1).max(500),
    notes: z.string().max(5000).nullable(),
    date: isoDate,
    amount: money,
    currency: z.string().length(3),
    exchangeRate: z.number().positive(),
    categoryId: z.string().nullable(),
    accountId: z.string(),
    entityId: z.string(),
    isTaxDeductible: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Empty patch");
export type EntryPatch = z.infer<typeof entryPatchSchema>;

export const bulkSelectionSchema = z.union([
  z.object({ ids: z.array(z.string()).min(1).max(5000) }),
  z.object({ query: ledgerSelectionQuerySchema }),
]);
export type BulkSelection = z.infer<typeof bulkSelectionSchema>;

export const bulkOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update"),
    selection: bulkSelectionSchema,
    patch: z
      .object({
        categoryId: z.string().nullable(),
        entityId: z.string(),
        accountId: z.string(),
        isTaxDeductible: z.boolean(),
        toggleTaxDeductible: z.literal(true),
      })
      .partial(),
    /** Learn a categorization rule from the descriptions of the selected rows. */
    createRule: z.boolean().optional(),
  }),
  z.object({ op: z.literal("delete"), selection: bulkSelectionSchema }),
  z.object({ op: z.literal("duplicate"), selection: bulkSelectionSchema }),
]);
export type BulkOperation = z.infer<typeof bulkOperationSchema>;

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export const VIEW_LAYOUTS = ["table", "pivot", "chart", "board", "calendar"] as const;
export const CHART_TYPES = ["bar", "hbar", "bar100", "line", "area", "pie", "donut", "treemap", "waterfall"] as const;
export const VIEW_DATASETS = ["ledger", "holdings", "investment_ops"] as const;

export const viewConfigSchema = z.object({
  layout: z.enum(VIEW_LAYOUTS).default("table"),
  period: periodSchema.default({ preset: "this_month", offset: 0 }),
  dateField: dateFieldSchema.default("date"),
  filters: z.array(ledgerFilterSchema).default([]),
  search: z.string().optional(),
  groupBy: z.array(groupKeySchema).max(2).default([]),
  sort: z.array(sortSchema).max(3).default([{ field: "date", dir: "desc" }]),
  columns: z.array(z.string()).default(["date", "description", "entityId", "accountId", "categoryId", "amountBase"]),
  /** Footer calculation per column, e.g. { amountBase: "sum", description: "count" }. */
  calcs: z.record(z.string(), z.enum([...AGG_FNS, "none"])).default({ amountBase: "sum" }),
  chart: z
    .object({
      type: z.enum(CHART_TYPES).default("bar"),
      metric: z.enum(["sum", "count", "avg"]).default("sum"),
      cumulative: z.boolean().default(false),
      top: z.number().int().min(0).max(50).default(0),
    })
    .default({}),
  /** How the transfer legs render: one row per group or one row per leg. */
  transferDisplay: z.enum(["group", "legs"]).default("group"),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const savedViewInputSchema = z.object({
  name: z.string().min(1).max(120),
  dataset: z.enum(VIEW_DATASETS).default("ledger"),
  isFavorite: z.boolean().default(true),
  config: viewConfigSchema,
});
export type SavedViewInput = z.infer<typeof savedViewInputSchema>;

export const savedViewPatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    isFavorite: z.boolean(),
    position: z.number().int().min(0),
    config: viewConfigSchema,
  })
  .partial();
export type SavedViewPatch = z.infer<typeof savedViewPatchSchema>;

/** Display preferences the built-in "Todas" view keeps; filters never persist on it. */
export const BUILTIN_ALL_VIEW_KEY = "all";
export const BUILTIN_PERSISTED_CONFIG_KEYS = ["layout", "period", "dateField", "groupBy", "sort", "columns", "calcs", "chart", "transferDisplay"] as const;
