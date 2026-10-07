import { z } from "zod";
import type { AllocationClass, InvestmentTransactionType } from "@/generated/prisma";
import { periodSchema } from "./common";

// ---------------------------------------------------------------------------
// View datasets
// ---------------------------------------------------------------------------

/** What a saved view lists: ledger rows, investment holdings or investment operations. */
export const VIEW_DATASETS = ["ledger", "holdings", "investment_ops"] as const;

export const viewDatasetSchema = z.enum(VIEW_DATASETS);
export type ViewDataset = z.infer<typeof viewDatasetSchema>;

export const VIEW_LAYOUTS = ["table", "pivot", "chart", "board", "calendar"] as const;
export const CHART_TYPES = ["bar", "hbar", "bar100", "line", "area", "pie", "donut", "treemap", "waterfall", "sankey"] as const;

const sortDir = z.enum(["asc", "desc"]).default("desc");
const datasetChartSchema = z
  .object({
    type: z.enum(CHART_TYPES).default("bar"),
    metric: z.enum(["sum", "count", "avg"]).default("sum"),
    cumulative: z.boolean().default(false),
    top: z.number().int().min(0).max(50).default(0),
  })
  .default({});

/**
 * The chart of a holdings view: the same fields, with the portfolio metrics
 * (valor de mercado, % da carteira, resultado) next to the legacy sum/count/avg
 * (stored by older configs; the client reads "sum" as the market value).
 */
export const HOLDINGS_CHART_METRICS = ["marketValue", "share", "result"] as const;
const holdingsChartSchema = z
  .object({
    type: z.enum(CHART_TYPES).default("bar"),
    metric: z.enum([...HOLDINGS_CHART_METRICS, "sum", "count", "avg"]).default("sum"),
    cumulative: z.boolean().default(false),
    top: z.number().int().min(0).max(50).default(0),
  })
  .default({});

// ---------------------------------------------------------------------------
// Holdings (Investimentos › Carteira tabs). The engine runs on the client
// over GET /v2/holdings; the server only stores the config.
// ---------------------------------------------------------------------------

export const ALLOCATION_CLASS_VALUES = ["fixed_income", "br_stocks", "fii", "international", "crypto", "cash"] as const satisfies readonly AllocationClass[];

export const HOLDINGS_GROUP_KEYS = ["allocationClass", "accountId", "entityId", "none"] as const;
export const HOLDINGS_FILTER_FIELDS = ["allocationClass", "accountId", "entityId"] as const;
/** Ativo, Classe, Corretora, Entidade, Valor, % cart., Result. */
export const HOLDINGS_COLUMNS = ["ticker", "allocationClass", "accountId", "entityId", "marketValue", "share", "result"] as const;
export const HOLDINGS_SORT_FIELDS = ["marketValue", "invested", "result", "share", "ticker"] as const;

export const holdingsFilterSchema = z.object({
  field: z.enum(HOLDINGS_FILTER_FIELDS),
  op: z.enum(["in", "nin"]).default("in"),
  values: z.array(z.string()).min(1),
});
export type HoldingsFilter = z.infer<typeof holdingsFilterSchema>;

export const holdingsViewConfigSchema = z.object({
  layout: z.enum(["table", "chart"]).default("table"),
  groupBy: z.enum(HOLDINGS_GROUP_KEYS).default("none"),
  filters: z.array(holdingsFilterSchema).default([]),
  columns: z.array(z.string()).default([...HOLDINGS_COLUMNS]),
  sort: z.object({ field: z.enum(HOLDINGS_SORT_FIELDS), dir: sortDir }).default({ field: "marketValue", dir: "desc" }),
  chart: holdingsChartSchema,
});
export type HoldingsViewConfig = z.infer<typeof holdingsViewConfigSchema>;

// ---------------------------------------------------------------------------
// Investment operations (Proventos 12m, Operações). Client engine over
// GET /v2/investment-operations.
// ---------------------------------------------------------------------------

export const OPERATION_TYPE_VALUES = [
  "buy",
  "sell",
  "dividend",
  "yield_payment",
  "split",
  "deposit",
  "withdrawal",
  "adjustment",
] as const satisfies readonly InvestmentTransactionType[];
/** Operation types that pay income (Proventos). */
export const INCOME_OPERATION_TYPES = ["dividend", "yield_payment"] as const satisfies readonly InvestmentTransactionType[];

export const OPS_GROUP_KEYS = ["month", "type", "allocationClass", "holdingId", "accountId", "none"] as const;
export const OPS_FILTER_FIELDS = ["type", "incomeType", "accountId", "holdingId", "entityId", "allocationClass"] as const;
export const OPS_COLUMNS = ["date", "type", "holdingId", "accountId", "quantity", "pricePerUnit", "totalAmount"] as const;
export const OPS_SORT_FIELDS = ["date", "totalAmount"] as const;

export const opsFilterSchema = z.object({
  field: z.enum(OPS_FILTER_FIELDS),
  op: z.enum(["in", "nin"]).default("in"),
  values: z.array(z.string()).min(1),
});
export type OpsFilter = z.infer<typeof opsFilterSchema>;

export const opsViewConfigSchema = z.object({
  layout: z.enum(["table", "chart"]).default("table"),
  period: periodSchema.default({ preset: "last_12m", offset: 0 }),
  filters: z.array(opsFilterSchema).default([]),
  groupBy: z.enum(OPS_GROUP_KEYS).default("none"),
  /** Chart series (a second grouping), e.g. Proventos by month × holding. */
  series: z.enum(OPS_GROUP_KEYS).default("none"),
  columns: z.array(z.string()).default([...OPS_COLUMNS]),
  sort: z.object({ field: z.enum(OPS_SORT_FIELDS), dir: sortDir }).default({ field: "date", dir: "desc" }),
  chart: datasetChartSchema,
});
export type OpsViewConfig = z.infer<typeof opsViewConfigSchema>;
