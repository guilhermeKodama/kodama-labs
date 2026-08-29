import { z } from "zod";
import { defineTool } from "../registry";
import { createInvestmentTransaction } from "../../../../investments/services/create-investment-transaction";
import { updateInvestmentTransactionService } from "../../../../investments/services/update-investment-transaction";
import { deleteInvestmentTransactionService } from "../../../../investments/services/delete-investment-transaction";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export const recordInvestmentTransaction = defineTool({
  name: "record_investment_transaction",
  description:
    "Record, correct, or remove a single investment movement (buy/sell/dividend/yield/deposit/withdrawal/split/adjustment) that the user is telling you about directly in chat - not from a statement file. For statement-driven investment transactions, use propose_import_plan's investmentTransactions instead, so they go through review before writing. Does NOT require plan confirmation here - one bounded, explicitly-requested movement is low-risk and fully reversible (delete correctly reverses the cash balance and holding recalculation), and every call is audited.",
  inputSchema: z.object({
    action: z.enum(["create", "update", "delete"]),
    transactionId: z.string().optional(),
    holdingId: z.string().optional(),
    type: z
      .enum(["buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal", "adjustment"])
      .optional(),
    quantity: z.number().optional(),
    pricePerUnit: z.number().optional(),
    totalAmount: z.number().optional(),
    fees: z.number().optional(),
    date: z.string().optional(),
    notes: z.string().optional(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    if (input.action === "create") {
      if (!input.holdingId) throw new Error("holdingId is required to record a transaction");
      if (!input.type) throw new Error("type is required to record a transaction");
      if (input.totalAmount === undefined) throw new Error("totalAmount is required to record a transaction");
      if (!input.date) throw new Error("date is required to record a transaction");

      const transaction = await createInvestmentTransaction(
        ctx.userId,
        {
          holdingId: input.holdingId,
          type: input.type,
          quantity: input.quantity,
          pricePerUnit: input.pricePerUnit,
          totalAmount: input.totalAmount,
          fees: input.fees,
          date: parseLocalDate(input.date),
          notes: input.notes,
        },
        ctx.db
      );

      return {
        transaction,
        createdRecords: [{ model: "InvestmentTransaction", id: transaction.id }],
      };
    }

    if (!input.transactionId) throw new Error(`transactionId is required for action "${input.action}"`);

    if (input.action === "delete") {
      await deleteInvestmentTransactionService(ctx.userId, input.transactionId, ctx.db);
      return {
        deleted: true,
        createdRecords: [{ model: "InvestmentTransaction", id: input.transactionId }],
      };
    }

    // action === "update"
    const transaction = await updateInvestmentTransactionService(
      ctx.userId,
      input.transactionId,
      {
        type: input.type,
        quantity: input.quantity,
        pricePerUnit: input.pricePerUnit,
        totalAmount: input.totalAmount,
        fees: input.fees,
        date: input.date ? parseLocalDate(input.date) : undefined,
        notes: input.notes,
      },
      ctx.db
    );
    return {
      transaction,
      createdRecords: [{ model: "InvestmentTransaction", id: transaction.id }],
    };
  },
});
