import { z } from "zod";
import { defineTool } from "../registry";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { deleteOperation, recordOperation, serializeOperation, updateOperation } from "@capital/server/modules/investments/services/portfolio";

const day = (value: string) => formatDateOnly(parseLocalDate(value));

export const recordInvestmentTransaction = defineTool({
  name: "record_investment_transaction",
  description:
    "Record, correct, or remove a single investment movement (buy/sell/dividend/yield/deposit/withdrawal/split/adjustment) that the user is telling you about directly in chat - not from a statement file. For statement-driven investment transactions, use propose_import_plan's investmentTransactions instead, so they go through review before writing. Each movement books its cash leg on the investment account (a buy takes cash out, a sale or dividend puts it in). Does NOT require plan confirmation here - one bounded, explicitly-requested movement is low-risk and fully reversible (delete removes the cash leg and recalculates the holding), and every call is audited.",
  inputSchema: z.object({
    action: z.enum(["create", "update", "delete"]),
    transactionId: z.string().optional(),
    holdingId: z.string().optional(),
    type: z.enum(["buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal", "adjustment"]).optional(),
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
      const { operation } = await recordOperation(
        ctx.userId,
        {
          holdingId: input.holdingId,
          type: input.type,
          quantity: input.quantity,
          pricePerUnit: input.pricePerUnit,
          totalAmount: input.totalAmount,
          fees: input.fees,
          date: day(input.date),
          notes: input.notes,
        },
        ctx.db
      );
      return { transaction: serializeOperation(operation), createdRecords: [{ model: "InvestmentOperation", id: operation.id }] };
    }

    if (!input.transactionId) throw new Error(`transactionId is required for action "${input.action}"`);

    if (input.action === "delete") {
      await deleteOperation(ctx.userId, input.transactionId, ctx.db);
      return { deleted: true, createdRecords: [{ model: "InvestmentOperation", id: input.transactionId }] };
    }

    const operation = await updateOperation(
      ctx.userId,
      input.transactionId,
      {
        type: input.type,
        quantity: input.quantity,
        pricePerUnit: input.pricePerUnit,
        totalAmount: input.totalAmount,
        fees: input.fees,
        date: input.date ? day(input.date) : undefined,
        notes: input.notes,
      },
      ctx.db
    );
    return { transaction: serializeOperation(operation), createdRecords: [{ model: "InvestmentOperation", id: operation.id }] };
  },
});
