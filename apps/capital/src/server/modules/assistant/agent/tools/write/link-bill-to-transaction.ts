import { z } from "zod";
import { defineTool } from "../registry";
import { createBillExpense } from "../../../../credit-cards/services/create-bill-expense";
import { linkBillToTransaction as linkBillToTransactionService } from "../../../../credit-cards/services/link-bill-transaction";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export const linkBillToTransactionTool = defineTool({
  name: "link_bill_to_transaction",
  description:
    "Connect a credit card bill to the ledger, one of two ways: \"create_expense\" makes a new expense Transaction for the bill's total (the normal path - a bill by itself is not an expense until this runs); \"link_existing\" instead attaches a Transaction the user already has (e.g. the bill payment line reconciled from a bank statement) so the same money isn't counted twice. Prefer link_existing whenever conciliating a bank statement turns up a bill-payment line for a bill you already know about. Does NOT require plan confirmation - one bounded, explicitly-requested link, fully reversible by unlinking (delete the created expense, or edit the bill directly) - and every call is audited.",
  inputSchema: z.object({
    action: z.enum(["create_expense", "link_existing"]),
    billId: z.string(),
    transactionId: z.string().optional(),
    entityType: z.enum(["business", "personal"]).optional(),
    businessId: z.string().optional(),
    personalAccountId: z.string().optional(),
    currency: z.string().optional(),
    exchangeRate: z.number().optional(),
    date: z.string().optional(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    if (input.action === "link_existing") {
      if (!input.transactionId) throw new Error("transactionId is required for action \"link_existing\"");
      const bill = await linkBillToTransactionService(
        ctx.userId,
        { billId: input.billId, transactionId: input.transactionId },
        ctx.db
      );
      return { bill, createdRecords: [] };
    }

    // action === "create_expense"
    if (!input.entityType) throw new Error("entityType is required for action \"create_expense\"");
    if (!input.currency || input.currency.length !== 3) {
      throw new Error("currency must be a 3-letter ISO code");
    }
    if (!input.date) throw new Error("date is required for action \"create_expense\"");

    const transaction = await createBillExpense(
      ctx.userId,
      {
        billId: input.billId,
        entityType: input.entityType,
        businessId: input.businessId,
        personalAccountId: input.personalAccountId,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        date: parseLocalDate(input.date),
      },
      ctx.db
    );
    return { transaction, createdRecords: [{ model: "Transaction", id: transaction.id }] };
  },
});
