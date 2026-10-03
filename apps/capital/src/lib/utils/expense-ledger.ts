import type { Currency, EntityType, Transaction } from "@/types";
import { parseLocalDate } from "@/lib/utils/date";
import { amountInUserBase } from "@/lib/utils/currency";
import { buildSettlementSet, shouldCountAsExpense } from "./expense-classification";

export interface ExpenseLedgerPurchase {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  transactionDate: Date | string;
}

export interface ExpenseLedgerStatement {
  id: string;
  month: string;
  closingDate?: Date | string | null;
  billPaymentTransactionId: string | null;
  creditCard: {
    entityId: string;
    entityType: EntityType;
    currency: string;
  };
  purchases: ExpenseLedgerPurchase[];
}

/**
 * Date a statement purchase counts in P&L and budgets.
 * Closing date when the statement has one; otherwise noon on YYYY-MM-01.
 * Display still uses the purchase's transactionDate.
 */
export function statementPurchaseEffectiveDate(statement: {
  month: string;
  closingDate?: Date | string | null;
}): Date {
  if (statement.closingDate) return parseLocalDate(statement.closingDate);
  return parseLocalDate(`${statement.month}-01`);
}

/**
 * P&L view of transactions.
 *
 * Drops card settlement payments (the statement link, or isCardSettlement).
 * Adds statement purchases as expense rows in the purchase currency, with
 * exchangeRate set so amount * exchangeRate is the base-currency value.
 * Those rows are flagged source: 'card_statement'.
 *
 * Cash views must keep the raw transaction list. This ledger is not a cash balance.
 */
export function buildExpenseLedger(
  transactions: Transaction[],
  statements: ExpenseLedgerStatement[],
  baseCurrency: string,
  currencies: Currency[] = []
): Transaction[] {
  const settlementIds = buildSettlementSet(statements);
  for (const tx of transactions) {
    if (tx.isCardSettlement) settlementIds.add(tx.id);
  }

  const kept = transactions.filter((tx) => {
    if (tx.type !== "expense") return true;
    return shouldCountAsExpense(tx, settlementIds.has(tx.id));
  });

  const now = new Date();
  const purchases: Transaction[] = [];
  for (const statement of statements) {
    const card = statement.creditCard;
    for (const purchase of statement.purchases) {
      const currency = purchase.currency || card.currency;
      const inBase = amountInUserBase({
        amount: purchase.amount,
        currency,
        currencies,
        baseCurrency,
      });
      const exchangeRate = purchase.amount !== 0 ? inBase / purchase.amount : 1;
      purchases.push({
        id: `cc-stmt-${purchase.id}`,
        entityId: card.entityId,
        entityType: card.entityType,
        type: "expense",
        amount: purchase.amount,
        currency,
        exchangeRate,
        description: purchase.description,
        category: purchase.category,
        date: statementPurchaseEffectiveDate(statement),
        source: "card_statement",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return [...kept, ...purchases];
}

/** Sum P&L expenses for one entity in a calendar month, keyed by category. */
export function sumLedgerExpensesByCategory(
  ledger: Transaction[],
  year: number,
  month: number,
  entityId: string
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const tx of ledger) {
    if (tx.type !== "expense" || tx.entityId !== entityId) continue;
    const date = tx.date instanceof Date ? tx.date : parseLocalDate(tx.date);
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month) continue;
    totals[tx.category] = (totals[tx.category] ?? 0) + tx.amount * tx.exchangeRate;
  }
  return totals;
}
