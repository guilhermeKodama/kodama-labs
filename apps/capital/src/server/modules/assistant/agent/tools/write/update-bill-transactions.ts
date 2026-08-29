import { z } from "zod";
import { defineTool } from "../registry";
import { updateBillTransaction } from "../../../../credit-cards/data/commands/update-bill-transaction";

export const updateBillTransactions = defineTool({
  name: "update_bill_transactions",
  description:
    "Correct the category of one or more EXISTING credit card bill line items - up to 100 per call. Does NOT require plan confirmation - recategorizing never touches amount, date, or balance, and is trivially reversible by calling this again. Each entry also learns the merchant->category mapping as \"manual\" (protected from being overwritten by the categorization cron or a future bill re-upload). Each id is applied independently - one bad id does not block the rest, check the per-item results for failures.",
  inputSchema: z.object({
    updates: z
      .array(
        z.object({
          billTransactionId: z.string(),
          category: z.string().min(1),
        })
      )
      .min(1)
      .max(100),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    const results: Array<{
      billTransactionId: string;
      success: boolean;
      category?: string;
      error?: string;
    }> = [];

    for (const update of input.updates) {
      try {
        const transaction = await updateBillTransaction(
          ctx.userId,
          update.billTransactionId,
          { category: update.category },
          ctx.db
        );
        results.push({ billTransactionId: transaction.id, success: true, category: transaction.category });
      } catch (error) {
        results.push({
          billTransactionId: update.billTransactionId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      updatedCount: results.filter((r) => r.success).length,
      failedCount: results.filter((r) => !r.success).length,
      results,
      createdRecords: results
        .filter((r) => r.success)
        .map((r) => ({ model: "BillTransaction", id: r.billTransactionId })),
    };
  },
});
