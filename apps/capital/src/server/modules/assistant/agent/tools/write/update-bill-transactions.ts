import { z } from "zod";
import { defineTool } from "../registry";
import { updateEntry } from "@capital/server/modules/ledger/services/entries";
import { inTransaction, recordMutation, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { learnRule } from "@capital/server/modules/ledger/services/rules";
import { categoryResolver } from "@capital/server/modules/mcp/lib/ledger-adapter";

export const updateBillTransactions = defineTool({
  name: "update_bill_transactions",
  description:
    "Correct the category of one or more EXISTING credit card purchases - up to 100 per call. Does NOT require plan confirmation - recategorizing never touches amount, date, or balance, and is trivially reversible by calling this again. Each entry also learns a \"manual\" categorization rule for the description, so future imports of the same merchant land in the same category. Each id is applied independently - one bad id does not block the rest, check the per-item results for failures.",
  inputSchema: z.object({
    updates: z
      .array(z.object({ billTransactionId: z.string(), category: z.string().min(1) }))
      .min(1)
      .max(100),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    const resolver = await categoryResolver(ctx.userId, ctx.db);
    const results: Array<{ billTransactionId: string; success: boolean; category?: string; error?: string }> = [];
    for (const update of input.updates) {
      try {
        const entry = await ctx.db.ledgerEntry.findFirst({
          where: { id: update.billTransactionId, userId: ctx.userId, deletedAt: null, transferGroupId: null, account: { type: "credit_card" } },
        });
        if (!entry) throw new Error("Bill transaction not found or access denied");
        const category = resolver.resolve(update.category, "expense", entry.categoryId);
        // The recategorization and the rule it learns are one undo batch.
        await inTransaction(ctx.db, async (tx) => {
          const records: MutationRecordInput[] = [];
          await updateEntry(ctx.userId, entry.id, { categoryId: category.id }, tx, { collect: records });
          await learnRule(ctx.userId, entry.description, category.id, "manual", tx, { collect: records });
          if (records.length) await recordMutation(tx, ctx.userId, "update", entry.description, records);
        });
        results.push({ billTransactionId: entry.id, success: true, category: category.name });
      } catch (error) {
        results.push({ billTransactionId: update.billTransactionId, success: false, error: error instanceof Error ? error.message : "Unknown error" });
      }
    }
    return {
      updatedCount: results.filter((r) => r.success).length,
      failedCount: results.filter((r) => !r.success).length,
      results,
      createdRecords: results.filter((r) => r.success).map((r) => ({ model: "LedgerEntry", id: r.billTransactionId })),
    };
  },
});
