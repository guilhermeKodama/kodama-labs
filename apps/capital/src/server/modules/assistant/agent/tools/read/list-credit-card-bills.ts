import { z } from "zod";
import { defineTool } from "../registry";
import { toNumber } from "@capital/server/modules/ledger/lib/money";

export const listCreditCardBills = defineTool({
  name: "list_credit_card_bills",
  description:
    "List the user's credit card bills (monthly statements), optionally filtered by card or status. Each bill shows its month, closing/due date, total, purchase count, how many purchases still lack a category, and whether a payment is already linked. Status is \"paid\" when a payment is linked, \"overdue\" when the due date passed without one, otherwise \"pending\". Call this to see what statements exist before importing one, or to find the bill to link/recategorize.",
  inputSchema: z.object({
    creditCardId: z.string().optional(),
    status: z.enum(["pending", "paid", "overdue"]).optional(),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const statements = await ctx.db.cardStatement.findMany({
      where: { account: { userId: ctx.userId, type: "credit_card", ...(input.creditCardId && { id: input.creditCardId }) } },
      include: {
        account: { select: { id: true, institution: true, name: true, externalId: true } },
        entries: { where: { deletedAt: null, transferGroupId: null }, select: { amount: true, categoryId: true, metadata: true } },
        paymentGroup: { include: { legs: { select: { id: true, accountId: true } } } },
      },
      orderBy: [{ month: "desc" }],
    });
    const now = new Date();
    const bills = statements.map((s) => {
      const purchases = s.entries.filter((e) => !(e.metadata as { projected?: boolean } | null)?.projected);
      const status = s.paymentGroupId ? "paid" : s.dueDate && s.dueDate < now ? "overdue" : "pending";
      return {
        id: s.id,
        month: s.month,
        creditCard: { id: s.account.id, bankName: s.account.institution ?? s.account.name, lastFourDigits: s.account.externalId, nickname: s.account.name },
        closingDate: s.closingDate?.toISOString().split("T")[0] ?? null,
        dueDate: s.dueDate?.toISOString().split("T")[0] ?? null,
        totalAmount: s.totalAmount !== null ? toNumber(s.totalAmount) : -purchases.reduce((sum, e) => sum + toNumber(e.amount), 0),
        status,
        transactionCount: purchases.length,
        uncategorizedCount: purchases.filter((e) => !e.categoryId).length,
        transactionId: s.paymentGroup?.legs.find((l) => l.accountId !== s.accountId)?.id ?? null,
      };
    });
    return { bills: input.status ? bills.filter((b) => b.status === input.status) : bills };
  },
});
