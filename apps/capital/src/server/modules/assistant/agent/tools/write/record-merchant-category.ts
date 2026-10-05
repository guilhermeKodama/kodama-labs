import { z } from "zod";
import { defineTool } from "../registry";
import { inTransaction, recordMutation, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { learnRule } from "@capital/server/modules/ledger/services/rules";
import { categoryResolver } from "@capital/server/modules/mcp/lib/ledger-adapter";

export const recordMerchantCategory = defineTool({
  name: "record_merchant_category",
  description:
    "Remember that a merchant/description maps to a category (a categorization rule), so future imports and new entries auto-categorize it. This is the one write tool that does NOT require plan confirmation - it is low-risk (never touches a balance or existing transaction), fully reversible, and every call is still audited. Use it when the user corrects a category during the conversation, or whenever you resolve an unfamiliar merchant while categorizing a statement (see 25-categorization.md) - pass the merchant/description as it appears on the statement, normalization happens here.",
  inputSchema: z.object({
    normalizedDescription: z.string().min(1),
    category: z.string().min(1),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    // Normalized by learnRule (not trusted from the model): "equals" rules
    // compare the normalized description, so any other form never matches.
    const category = (await categoryResolver(ctx.userId, ctx.db)).resolve(input.category, undefined);
    const rule = await inTransaction(ctx.db, async (tx) => {
      const records: MutationRecordInput[] = [];
      const learned = await learnRule(ctx.userId, input.normalizedDescription, category.id, "ai", tx, { collect: records });
      // Nothing recorded when the rule already pointed at this category.
      if (learned && records.length) await recordMutation(tx, ctx.userId, records[0].before ? "update" : "create", learned.pattern, records);
      return learned;
    });
    if (!rule) throw new Error("The description is empty after normalization");
    return {
      normalizedDescription: rule.pattern,
      category: category.name,
      createdRecords: [{ model: "CategorizationRule", id: rule.id }],
    };
  },
});
