import { z } from "zod";
import { defineTool } from "../registry";
import { normalizeDescription } from "../../../../bank-statements/utils";

export const recordMerchantCategory = defineTool({
  name: "record_merchant_category",
  description:
    "Remember that a normalized merchant/description maps to a category, so future imports auto-categorize it. This is the one write tool that does NOT require plan confirmation - it is low-risk (never touches a balance or existing transaction), fully reversible, and every call is still audited. Use it when the user corrects a category during the conversation, or whenever you resolve an unfamiliar merchant while categorizing a statement (see 25-categorization.md) - pass the merchant/description as it appears on the statement, normalization happens here.",
  inputSchema: z.object({
    normalizedDescription: z.string().min(1),
    category: z.string().min(1),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    // Normalized here (not trusted from the model) because
    // execute-import.ts's commit-time fallback looks up this exact
    // lowercase().trim() form against transaction descriptions - a
    // mapping stored with different casing would just silently never
    // match.
    const normalizedDescription = normalizeDescription(input.normalizedDescription);
    const mapping = await ctx.db.merchantCategoryMapping.upsert({
      where: {
        userId_normalizedDescription: {
          userId: ctx.userId,
          normalizedDescription,
        },
      },
      create: {
        userId: ctx.userId,
        normalizedDescription,
        category: input.category,
        source: "ai",
      },
      update: { category: input.category, source: "ai" },
    });

    return {
      normalizedDescription: mapping.normalizedDescription,
      category: mapping.category,
      createdRecords: [{ model: "MerchantCategoryMapping", id: mapping.id }],
    };
  },
});
