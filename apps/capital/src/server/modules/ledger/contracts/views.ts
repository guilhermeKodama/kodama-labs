import { z } from "zod";
import { dateFieldSchema, periodSchema } from "./common";
import { viewDatasetSchema } from "./datasets";
import { ledgerFilterSchema } from "./filters";
import { AGG_FNS, groupKeySchema, sortSchema } from "./query";

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export const VIEW_LAYOUTS = ["table", "pivot", "chart", "board", "calendar"] as const;
export const CHART_TYPES = ["bar", "hbar", "bar100", "line", "area", "pie", "donut", "treemap", "waterfall", "sankey"] as const;

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
  dataset: viewDatasetSchema.default("ledger"),
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
