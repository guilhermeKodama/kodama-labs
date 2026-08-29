import { z } from "zod";
import { defineTool } from "../registry";
import { fetchBills } from "../../../../credit-cards/data/queries/fetch-bills";

export const listCreditCardBills = defineTool({
  name: "list_credit_card_bills",
  description:
    "List the user's credit card bills, optionally filtered by card or status. Each bill shows its period (closing/due date), total, line-item count, categorization status, and whether it's already linked to a ledger expense. Call this to see what bills already exist before proposing a new one, or to find the bill to link/recategorize.",
  inputSchema: z.object({
    creditCardId: z.string().optional(),
    status: z.enum(["pending", "paid", "overdue"]).optional(),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const bills = await fetchBills(
      ctx.userId,
      { creditCardId: input.creditCardId, status: input.status },
      ctx.db
    );
    return {
      bills: bills.map((b) => ({
        id: b.id,
        creditCard: {
          id: b.creditCard.id,
          bankName: b.creditCard.bankName,
          lastFourDigits: b.creditCard.lastFourDigits,
          nickname: b.creditCard.nickname,
        },
        closingDate: b.closingDate.toISOString().split("T")[0],
        dueDate: b.dueDate.toISOString().split("T")[0],
        totalAmount: b.totalAmount,
        status: b.status,
        categorizationStatus: b.categorizationStatus,
        transactionCount: b._count.billTransactions,
        transactionId: b.transactionId,
      })),
    };
  },
});
