import { z } from "zod";
import { ledgerSelectionQuerySchema } from "./query";

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

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
