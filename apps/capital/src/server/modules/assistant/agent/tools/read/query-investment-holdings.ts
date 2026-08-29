import { z } from "zod";
import { defineTool } from "../registry";
import { fetchInvestmentHoldingsForAgent } from "../../../data/queries/fetch-investment-holdings";

export const queryInvestmentHoldings = defineTool({
  name: "query_investment_holdings",
  description:
    "List the user's investment accounts and active holdings (with the last 5 movements per holding). Call this before proposing investment transactions from a PDF, to match line items against positions that already exist instead of creating duplicates.",
  inputSchema: z.object({
    accountId: z.string().optional(),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const accounts = await fetchInvestmentHoldingsForAgent(ctx.userId, input.accountId, ctx.db);
    return { accounts };
  },
});
