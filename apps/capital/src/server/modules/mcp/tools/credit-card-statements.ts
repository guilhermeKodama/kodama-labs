import type { DbClient } from "@capital/server/lib/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { importCardStatement, isProjected } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { markStatementPayment, unmarkStatementPayment } from "@capital/server/modules/ledger/services/statements";

interface StatementRow {
  date: string; // YYYY-MM-DD or ISO
  description: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  category?: string;
  installment?: { number: number; total: number };
}

interface ImportStatementParams {
  creditCardId: string;
  statement: { month: string; closingDate?: string; dueDate?: string; total?: number };
  rows: StatementRow[];
}

const day = (value: string) => formatDateOnly(parseLocalDate(value));

/**
 * Import a monthly statement. Rows are a multiset, so re-importing the same
 * file inserts nothing; unknown category names fall back to the system
 * Other expense. Purchases count on the statement's closing date.
 */
export async function importCreditCardStatement(userId: string, params: ImportStatementParams, db: DbClient) {
  const card = await db.account.findFirst({ where: { id: params.creditCardId, userId, type: "credit_card" } });
  if (!card) throw new Error("Credit card not found or access denied");
  return importCardStatement(
    userId,
    {
      accountId: card.id,
      month: params.statement.month,
      closingDate: params.statement.closingDate ? day(params.statement.closingDate) : null,
      dueDate: params.statement.dueDate ? day(params.statement.dueDate) : null,
      total: params.statement.total ?? null,
      rows: params.rows.map((r) => ({ ...r, date: day(r.date) })),
      fallback: "other",
    },
    db
  );
}

/**
 * Turn a bank-account expense into the payment of a statement: it becomes a
 * card_payment transfer from the account to the card, so it stops counting
 * as an expense (the purchases already do). The category is left as-is.
 */
export async function markTransactionAsCardSettlement(userId: string, params: { transactionId: string; statementId: string }, db: DbClient) {
  await markStatementPayment(userId, params.transactionId, params.statementId, db);
  return { success: true, transactionId: params.transactionId, statementId: params.statementId };
}

/** Undo the settlement: the payment counts as an expense again. */
export async function unmarkTransactionAsCardSettlement(userId: string, params: { transactionId: string }, db: DbClient) {
  const { statementId } = await unmarkStatementPayment(userId, params.transactionId, db);
  return { success: true, transactionId: params.transactionId, statementId };
}

/**
 * A statement with its purchases (projected installments excluded) and the
 * reconciliation of purchases vs. payment, in the base currency.
 */
export async function getCreditCardStatement(userId: string, params: { statementId?: string; creditCardId?: string; month?: string }, db: DbClient) {
  const where = params.statementId
    ? { id: params.statementId, account: { userId } }
    : params.creditCardId && params.month
      ? { accountId: params.creditCardId, month: params.month, account: { userId } }
      : null;
  if (!where) throw new Error("Must provide either statementId or (creditCardId + month)");
  const statement = await db.cardStatement.findFirst({
    where,
    include: {
      account: { select: { id: true, institution: true, name: true, externalId: true, currency: true } },
      entries: { where: { deletedAt: null }, include: { category: { select: { name: true } } }, orderBy: { date: "asc" } },
      paymentGroup: { include: { legs: true } },
    },
  });
  if (!statement) throw new Error("Statement not found or access denied");

  const user = await db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } });
  const purchases = statement.entries.filter((e) => !e.transferGroupId && !isProjected(e.metadata));
  const purchasesTotal = -purchases.reduce((s, e) => s + toNumber(e.amountBase), 0);
  const paymentLeg = statement.paymentGroup?.legs.find((l) => l.accountId !== statement.accountId) ?? null;
  const paymentAmount = paymentLeg ? Math.round(-toNumber(paymentLeg.amountBase) * 100) / 100 : null;
  const difference = paymentAmount !== null ? paymentAmount - purchasesTotal : null;

  return {
    statement: {
      id: statement.id,
      month: statement.month,
      closingDate: statement.closingDate?.toISOString() ?? null,
      dueDate: statement.dueDate?.toISOString() ?? null,
      totalAmount: statement.totalAmount === null ? null : toNumber(statement.totalAmount),
      creditCard: {
        id: statement.account.id,
        bankName: statement.account.institution ?? statement.account.name,
        lastFourDigits: statement.account.externalId,
        currency: statement.account.currency,
      },
    },
    purchases: purchases.map((e) => {
      const total = (e.metadata as { totalInstallments?: number } | null)?.totalInstallments;
      return {
        id: e.id,
        category: e.category?.name ?? null,
        date: e.date.toISOString(),
        description: e.description,
        amount: -toNumber(e.amount),
        currency: e.currency,
        installment: e.installmentNumber && total ? { number: e.installmentNumber, total } : null,
      };
    }),
    billPayment: paymentLeg
      ? { id: paymentLeg.id, amount: Math.abs(toNumber(paymentLeg.amount)), currency: paymentLeg.currency, date: paymentLeg.date.toISOString(), description: paymentLeg.description }
      : null,
    reconciliation: {
      currency: user?.baseCurrency ?? "USD",
      purchasesTotal: Math.round(purchasesTotal * 100) / 100,
      paymentAmount,
      difference: difference !== null ? Math.round(difference * 100) / 100 : null,
      isReconciled: difference !== null ? Math.abs(difference) < 0.01 : false,
    },
  };
}
