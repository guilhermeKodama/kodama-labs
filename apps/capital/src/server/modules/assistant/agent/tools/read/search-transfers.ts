import { z } from "zod";
import { defineTool } from "../registry";
import { searchTransfersForAgent } from "../../../data/queries/search-for-agent";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export const searchTransfers = defineTool({
  name: "search_transfers",
  description:
    "Search the user's existing transfers between entities (or to/from investment accounts) - by entity, date range, or a batch of externalIds. Use this to check whether a Pix or TED the statement shows already exists as a recorded transfer before treating it as new.",
  inputSchema: z.object({
    entityType: z.enum(["business", "personal"]).optional(),
    entityId: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    externalIds: z.array(z.string()).max(100).optional(),
    limit: z.number().int().min(1).max(50).default(50),
    offset: z.number().int().min(0).optional(),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const result = await searchTransfersForAgent(
      ctx.userId,
      {
        entityType: input.entityType,
        entityId: input.entityId,
        dateFrom: input.dateFrom ? parseLocalDate(input.dateFrom) : undefined,
        dateTo: input.dateTo ? parseLocalDate(input.dateTo) : undefined,
        externalIds: input.externalIds,
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
        direction: r.direction,
        externalId: r.externalId,
        fromBusinessId: r.fromBusinessId,
        fromPersonalAccountId: r.fromPersonalAccountId,
        fromInvestmentAccountId: r.fromInvestmentAccountId,
        toBusinessId: r.toBusinessId,
        toPersonalAccountId: r.toPersonalAccountId,
        toInvestmentAccountId: r.toInvestmentAccountId,
      })),
    };
  },
});
