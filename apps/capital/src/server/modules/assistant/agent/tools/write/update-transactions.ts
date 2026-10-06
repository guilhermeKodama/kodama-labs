import { z } from "zod";
import { defineTool } from "../registry";
import { updateTransactionTool } from "@capital/server/modules/mcp/tools/manage-transactions";

export const updateTransactions = defineTool({
  name: "update_transactions",
  description:
    "Correct the category and/or type (income/expense/investment) of one or more EXISTING transactions (bank entries or card purchases) the user points you at in chat - up to 100 per call. Does NOT require plan confirmation - recategorizing never touches amount, date, or balance, and is trivially reversible by calling this again. Only category/type change here; amount, date and description are not editable through this tool. Each transactionId is applied independently - one bad id does not block the rest, check the per-item results for failures and retry only those.",
  inputSchema: z.object({
    updates: z
      .array(
        z.object({
          transactionId: z.string(),
          category: z.string().optional(),
          type: z.enum(["income", "expense", "investment"]).optional(),
        })
      )
      .min(1)
      .max(100),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    const results: Array<{ transactionId: string; success: boolean; category?: string; type?: string; error?: string }> = [];
    for (const update of input.updates) {
      if (!update.category && !update.type) {
        results.push({ transactionId: update.transactionId, success: false, error: "neither category nor type provided" });
        continue;
      }
      try {
        const t = await updateTransactionTool(ctx.userId, { id: update.transactionId, category: update.category, type: update.type }, ctx.db);
        results.push({ transactionId: t.id, success: true, category: t.category ?? undefined, type: t.type });
      } catch (error) {
        results.push({ transactionId: update.transactionId, success: false, error: error instanceof Error ? error.message : "Unknown error" });
      }
    }
    return {
      updatedCount: results.filter((r) => r.success).length,
      failedCount: results.filter((r) => !r.success).length,
      results,
      createdRecords: results.filter((r) => r.success).map((r) => ({ model: "LedgerEntry", id: r.transactionId })),
    };
  },
});
