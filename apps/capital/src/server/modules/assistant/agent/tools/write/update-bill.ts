import { z } from "zod";
import { defineTool } from "../registry";
import { updateBill as updateBillService } from "../../../../credit-cards/services/update-bill";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export const updateBillTool = defineTool({
  name: "update_bill",
  description:
    "Correct a bill's own closingDate/dueDate after it was created. These live on the bill itself, not on the CreditCard (which only holds the recurring closingDay/dueDay used as a default for new bills) - so this is the right tool when a specific bill's dates are wrong (e.g. guessed incorrectly from a statement import) and fixing the card's recurring day wouldn't touch this bill's own values. Does NOT require plan confirmation - one bounded, explicitly-requested correction, fully reversible by calling again, and every call is audited.",
  inputSchema: z.object({
    billId: z.string(),
    closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    if (!input.closingDate && !input.dueDate) {
      throw new Error("At least one of closingDate or dueDate is required");
    }
    const bill = await updateBillService(
      ctx.userId,
      input.billId,
      {
        closingDate: input.closingDate ? parseLocalDate(input.closingDate) : undefined,
        dueDate: input.dueDate ? parseLocalDate(input.dueDate) : undefined,
      },
      ctx.db
    );
    return { bill, createdRecords: [] };
  },
});
