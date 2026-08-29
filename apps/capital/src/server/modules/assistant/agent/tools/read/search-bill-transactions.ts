import { z } from "zod";
import { defineTool } from "../registry";
import { searchBillTransactionsForAgent } from "../../../data/queries/search-for-agent";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export const searchBillTransactions = defineTool({
  name: "search_bill_transactions",
  description:
    "Search the user's credit card bill line items - by card, bill, category, date range, or description substring - and get back both the matching rows (capped at 50) AND a category breakdown (total + count) computed over the full filtered set, not just the page. Use this to answer any 'how much did I spend on X' question about card spending - the breakdown is the answer, don't sum the capped rows yourself.",
  inputSchema: z.object({
    creditCardId: z.string().optional(),
    billId: z.string().optional(),
    category: z.string().optional(),
    descriptionContains: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(50),
    offset: z.number().int().min(0).optional(),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const result = await searchBillTransactionsForAgent(
      ctx.userId,
      {
        creditCardId: input.creditCardId,
        billId: input.billId,
        category: input.category,
        descriptionContains: input.descriptionContains,
        dateFrom: input.dateFrom ? parseLocalDate(input.dateFrom) : undefined,
        dateTo: input.dateTo ? parseLocalDate(input.dateTo) : undefined,
        limit: input.limit,
        offset: input.offset,
      },
      ctx.db
    );

    return {
      total: result.total,
      byCategory: result.byCategory,
      rows: result.rows.map((r) => ({
        id: r.id,
        billId: r.billId,
        date: r.transactionDate.toISOString().split("T")[0],
        description: r.description,
        merchantName: r.merchantName,
        amount: r.amount,
        category: r.category,
        installmentNumber: r.installmentNumber,
        totalInstallments: r.totalInstallments,
      })),
    };
  },
});
