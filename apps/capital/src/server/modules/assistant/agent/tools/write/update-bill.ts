import { z } from "zod";
import { defineTool } from "../registry";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { updateStatementDates } from "@capital/server/modules/ledger/services/statements";

export const updateBillTool = defineTool({
  name: "update_bill",
  description:
    "Correct a bill's (statement's) own closingDate/dueDate after it was created. These live on the statement itself, not on the card (which only holds the recurring closingDay/dueDay used as a default for new statements) - so this is the right tool when a specific statement's dates are wrong (e.g. guessed incorrectly from an import). Its purchases move with the closing date, since that is when they count. Does NOT require plan confirmation - one bounded, explicitly-requested correction, fully reversible by calling again, and every call is audited.",
  inputSchema: z.object({
    billId: z.string(),
    closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    if (!input.closingDate && !input.dueDate) throw new Error("At least one of closingDate or dueDate is required");
    const statement = await updateStatementDates(
      ctx.userId,
      input.billId,
      { closingDate: input.closingDate ? parseLocalDate(input.closingDate) : undefined, dueDate: input.dueDate ? parseLocalDate(input.dueDate) : undefined },
      ctx.db
    );
    return {
      bill: { id: statement.id, month: statement.month, closingDate: statement.closingDate?.toISOString().slice(0, 10) ?? null, dueDate: statement.dueDate?.toISOString().slice(0, 10) ?? null },
      createdRecords: [],
    };
  },
});
