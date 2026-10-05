import { z } from "zod";

// ---------------------------------------------------------------------------
// View datasets
// ---------------------------------------------------------------------------

/** What a saved view lists: ledger rows, investment holdings or investment operations. */
export const VIEW_DATASETS = ["ledger", "holdings", "investment_ops"] as const;

export const viewDatasetSchema = z.enum(VIEW_DATASETS);
export type ViewDataset = z.infer<typeof viewDatasetSchema>;
