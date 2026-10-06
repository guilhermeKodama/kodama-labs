import { z } from "zod";
import { dateFieldSchema, periodSchema } from "./common";
import { CHART_TYPES, holdingsViewConfigSchema, opsViewConfigSchema, VIEW_LAYOUTS, type ViewDataset } from "./datasets";
import { ledgerFilterSchema } from "./filters";
import { AGG_FNS, groupKeySchema, sortSchema } from "./query";

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

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

/** The config schema of each dataset. */
export const VIEW_CONFIG_SCHEMAS = {
  ledger: viewConfigSchema,
  holdings: holdingsViewConfigSchema,
  investment_ops: opsViewConfigSchema,
} as const satisfies Record<ViewDataset, z.ZodTypeAny>;

export type AnyViewConfig = z.infer<(typeof VIEW_CONFIG_SCHEMAS)[ViewDataset]>;

const viewName = z.string().min(1).max(120);

/** A new view; the config schema follows the dataset (ledger when omitted). */
export const savedViewInputSchema = z.union([
  z.object({ name: viewName, dataset: z.literal("ledger").default("ledger"), isFavorite: z.boolean().default(true), config: viewConfigSchema }),
  z.object({ name: viewName, dataset: z.literal("holdings"), isFavorite: z.boolean().default(true), config: holdingsViewConfigSchema }),
  z.object({ name: viewName, dataset: z.literal("investment_ops"), isFavorite: z.boolean().default(true), config: opsViewConfigSchema }),
]);
export type SavedViewInput = z.infer<typeof savedViewInputSchema>;

/** A raw config object: validated against the view's dataset schema by the service. */
const rawConfig = z.record(z.string(), z.unknown());

export const savedViewPatchSchema = z
  .object({
    name: viewName,
    isFavorite: z.boolean(),
    position: z.number().int().min(0),
    config: rawConfig,
  })
  .partial();
export type SavedViewPatch = z.infer<typeof savedViewPatchSchema>;

/** POST /v2/views/{id}/duplicate: the copy takes `config` (the one on screen, drafts included) over the stored one. */
export const duplicateViewSchema = z.object({
  name: viewName.optional(),
  config: rawConfig.optional(),
});
export type DuplicateViewInput = z.infer<typeof duplicateViewSchema>;

/** Display preferences the built-in "Todas" view keeps; filters never persist on it. */
export const BUILTIN_ALL_VIEW_KEY = "all";
export const BUILTIN_PERSISTED_CONFIG_KEYS = ["layout", "period", "dateField", "groupBy", "sort", "columns", "calcs", "chart", "transferDisplay"] as const;
