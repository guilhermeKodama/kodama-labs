import { z } from "zod";
import { defineTool } from "../registry";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { getDefaultAccount, resolveLegacyEntity } from "@capital/server/modules/ledger/services/entities";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";
import { markStatementPayment } from "@capital/server/modules/ledger/services/statements";

export const linkBillToTransactionTool = defineTool({
  name: "link_bill_to_transaction",
  description:
    "Record how a credit card bill (statement) was paid. The purchases on the statement are already the expenses; the payment is a card_payment transfer from a bank account to the card, so the same money is never counted twice. \"link_existing\" turns a bank-account expense the user already has (e.g. the bill payment line reconciled from a bank statement) into that payment - prefer it whenever conciliating a bank statement turns up a bill-payment line. \"create_expense\" books a new payment for the statement total from the entity's main account. Does NOT require plan confirmation - one bounded, explicitly-requested link, reversible with unmark/undo - and every call is audited.",
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
      const { statement, groupId } = await markStatementPayment(ctx.userId, input.transactionId, input.billId, ctx.db);
      return { bill: { id: statement.id, month: statement.month, paymentGroupId: groupId }, createdRecords: [{ model: "TransferGroup", id: groupId }] };
    }

    if (!input.entityType) throw new Error("entityType is required for action \"create_expense\"");
    if (!input.currency || input.currency.length !== 3) throw new Error("currency must be a 3-letter ISO code");
    if (!input.date) throw new Error("date is required for action \"create_expense\"");

    return inTransaction(ctx.db, async (tx) => {
      const statement = await tx.cardStatement.findFirst({ where: { id: input.billId, account: { userId: ctx.userId } }, include: { entries: { where: { deletedAt: null, transferGroupId: null } } } });
      if (!statement) throw new Error("Bill not found or access denied");
      const total = statement.totalAmount !== null ? toNumber(statement.totalAmount) : -statement.entries.reduce((s, e) => s + toNumber(e.amount), 0);
      if (!(total > 0)) throw new Error("The bill has no total to pay");
      const entity = await resolveLegacyEntity(ctx.userId, input, tx);
      const from = await getDefaultAccount(entity, tx);
      const payment = await createEntry(
        ctx.userId,
        { kind: "expense", accountId: from.id, amount: Math.round(total * 100) / 100, currency: input.currency!, exchangeRate: input.exchangeRate, date: formatDateOnly(parseLocalDate(input.date!)), description: `Pagamento fatura ${statement.month}` },
        tx,
        { record: false, skipRules: true }
      );
      const { groupId } = await markStatementPayment(ctx.userId, payment.entryIds[0], statement.id, tx);
      return { transaction: { id: payment.entryIds[0], amount: total, transferGroupId: groupId }, createdRecords: [{ model: "TransferGroup", id: groupId }] };
    });
  },
});
