import { z } from "zod";
import { defineTool } from "../registry";
import { searchTransactionsForAgent } from "../../../data/queries/search-for-agent";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export const searchTransactions = defineTool({
  name: "search_transactions",
  description:
    "Search the user's existing transactions - by entity, date range, description substring, amount range, a batch of externalIds, or a statement import batch. Use this to check whether something the statement mentions was already entered manually, or to look up a specific import's contents. Capped at 50 rows per call.",
  inputSchema: z.object({
    entityType: z.enum(["business", "personal"]).optional(),
    entityId: z.string().optional(),
    type: z.enum(["income", "expense", "investment"]).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    descriptionContains: z.string().optional(),
    amountMin: z.number().optional(),
    amountMax: z.number().optional(),
    externalIds: z.array(z.string()).max(100).optional(),
    statementImportId: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(50),
    offset: z.number().int().min(0).optional(),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const result = await searchTransactionsForAgent(
      ctx.userId,
      {
        entityType: input.entityType,
        entityId: input.entityId,
        type: input.type,
        dateFrom: input.dateFrom ? parseLocalDate(input.dateFrom) : undefined,
        dateTo: input.dateTo ? parseLocalDate(input.dateTo) : undefined,
        descriptionContains: input.descriptionContains,
        amountMin: input.amountMin,
        amountMax: input.amountMax,
        externalIds: input.externalIds,
        statementImportId: input.statementImportId,
        limit: input.limit,
        offset: input.offset,
      },
      ctx.db
    );

    return {
      total: result.total,
      rows: result.rows.map((r) => ({
        id: r.id,
        date: r.date.toISOString().split("T")[0],
        description: r.description,
        amount: r.amount,
        type: r.type,
        category: r.category,
        externalId: r.externalId,
        statementImportId: r.statementImportId,
      })),
    };
  },
});
