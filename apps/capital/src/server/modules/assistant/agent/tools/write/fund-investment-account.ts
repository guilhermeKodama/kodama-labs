import { z } from "zod";
import { defineTool } from "../registry";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { moveBrokerageCash } from "@capital/server/modules/investments/services/portfolio";

export const fundInvestmentAccountTool = defineTool({
  name: "fund_investment_account",
  description:
    "Move cash between an investment account and the main checking account of the business/personal entity that owns it - deposit sends money into the investment account (an investment_deposit transfer), withdraw brings it back (an investment_withdrawal transfer). Neither side counts as income or expense. Does NOT require plan confirmation - it is one bounded, explicitly-requested movement (not bulk-derived from an uploaded file), and it is reversible from the trash/undo like any entry. Every call is audited.",
  inputSchema: z.object({
    action: z.enum(["deposit", "withdraw"]),
    accountId: z.string(),
    amount: z.number().positive(),
    currency: z.string().length(3),
    exchangeRate: z.number().optional(),
    description: z.string().optional(),
    date: z.string(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    const result = await moveBrokerageCash(
      ctx.userId,
      {
        accountId: input.accountId,
        direction: input.action,
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        description: input.description,
        date: formatDateOnly(parseLocalDate(input.date)),
      },
      ctx.db
    );
    return {
      transferGroupId: result.transferGroupId,
      entryIds: result.entryIds,
      batchId: result.batchId,
      createdRecords: [{ model: "TransferGroup", id: result.transferGroupId! }],
    };
  },
});
