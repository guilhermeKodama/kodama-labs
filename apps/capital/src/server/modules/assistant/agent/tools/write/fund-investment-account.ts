import { z } from "zod";
import { defineTool } from "../registry";
import { fundInvestmentAccount, withdrawInvestmentAccount } from "../../../../investments/services/fund-investment-account";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export const fundInvestmentAccountTool = defineTool({
  name: "fund_investment_account",
  description:
    "Move cash between an investment account and the checking account of the business/personal entity that owns it - deposit sends money into the investment account's cash balance (and creates a matching expense on the entity), withdraw brings it back out (and creates a matching income). Does NOT require plan confirmation - it is one bounded, explicitly-requested movement (not bulk-derived from an uploaded file), and it is fully reversible: deleting the linked movement via record_investment_transaction reverses both the cash balance and the entity transaction. Every call is audited.",
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
    const args = {
      accountId: input.accountId,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      description: input.description,
      date: parseLocalDate(input.date),
    };

    const result =
      input.action === "deposit"
        ? await fundInvestmentAccount(ctx.userId, args, ctx.db)
        : await withdrawInvestmentAccount(ctx.userId, args, ctx.db);

    return {
      account: result.account,
      linkedTransaction: result.linkedTransaction,
      createdRecords: [
        { model: "InvestmentAccount", id: result.account.id },
        { model: "Transaction", id: result.linkedTransaction.id },
      ],
    };
  },
});
