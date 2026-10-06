import type { PrismaClient } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { calculateBillTotal, parseCardFile } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { parseDate } from "@capital/server/modules/credit-cards/services/parsers";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { round } from "@capital/server/modules/ledger/lib/money";
import { executeImport } from "./execute-import";

/**
 * POST /v2/accounts/{id}/statements/import-file: a card bill file booked on
 * the statement closing on `closingDate`, as a real import (an Import row
 * on the card, its rows tagged with it, one undo batch, revertable from the
 * history).
 */
export async function importCardBill(
  userId: string,
  input: { accountId: string; closingDate: string; dueDate: string; content: string; fileName?: string },
  db: PrismaClient
) {
  const card = await db.account.findFirst({ where: { id: input.accountId, userId }, include: { entity: true } });
  if (!card) throw notFound("Account", "account.not_found");
  if (card.type !== "credit_card") throw new LedgerError("Account is not a credit card", 422, { code: "account.not_credit_card" });
  const parsed = parseCardFile(input.content);
  const closing = parseLocalDate(input.closingDate);
  const month = input.closingDate.slice(0, 7);
  const rows = parsed
    .filter((t) => !t.isPayment)
    .map((t) => {
      let date: string;
      try {
        date = parseDate(t.date).toISOString().slice(0, 10);
      } catch (err) {
        throw new LedgerError(err instanceof Error ? err.message : "Invalid bill file", 400, { code: "import.invalid_file" });
      }
      return {
        date,
        description: t.description,
        amount: t.amount,
        ...(t.installmentNumber && t.totalInstallments && t.totalInstallments > 1 && { installment: { number: t.installmentNumber, total: t.totalInstallments } }),
      };
    })
    .filter((r) => r.amount !== 0);
  const result = await executeImport(
    userId,
    {
      entityType: card.entity.kind,
      entityId: card.entityId,
      accountId: card.id,
      currency: card.currency,
      bankName: card.institution ?? undefined,
      fileName: input.fileName,
      cardStatement: { month, closingDate: input.closingDate, dueDate: input.dueDate, total: round(calculateBillTotal(parsed, closing), 2), rows },
      transactions: [],
      transfers: [],
      investmentTransfers: [],
      creditCards: [],
      bills: [],
      reconciliations: [],
      transferReconciliations: [],
      duplicateDecisions: [],
      investmentTransactions: [],
    },
    db,
    { source: "manual" }
  );
  return {
    importId: result.importId,
    batchId: result.batchId,
    statementId: result.cardStatementId,
    month,
    created: result.cardRowsCreated,
    skipped: result.cardRowsSkipped,
    transactionCount: rows.length,
  };
}
