import type { Transaction } from "@/types";
import type { Transaction as PrismaTransaction } from "@/generated/prisma";

/**
 * Determine if a transaction should count as an expense in totals, budgets, and reports.
 *
 * Excludes:
 * - Credit card bill payment transactions (category "Credit Card")
 *   These are settlement transactions that move money from checking to pay off the
 *   card balance. The actual purchases on the statement are the real expenses.
 *
 * This is the single source of truth for "what counts as an expense" across:
 * - Dashboard and report totals
 * - Budget calculations
 * - MCP tool summaries
 * - Any other expense aggregation
 *
 * Design rationale: Credit card purchases are recorded as BillTransactions linked to
 * a CreditCardStatement. When the user pays the bill, that payment transaction has
 * category "Credit Card" and should NOT be counted as an expense (it would double-count
 * everything on the statement). The statement's billPaymentTransactionId links to this
 * payment transaction. By excluding transactions with category "Credit Card", we prevent
 * double-counting while keeping the data model simple: purchases remain as BillTransactions
 * (the real expenses) and the payment is just a transfer/settlement.
 */
export function shouldCountAsExpense(
  transaction: Pick<Transaction, "type" | "category"> | Pick<PrismaTransaction, "type" | "category">
): boolean {
  if (transaction.type !== "expense") {
    return false;
  }

  // Exclude credit card bill payment transactions
  if (transaction.category === "Credit Card") {
    return false;
  }

  return true;
}

/**
 * Filter an array of transactions to only those that count as expenses.
 */
export function filterCountingExpenses<T extends Pick<Transaction, "type" | "category">>(
  transactions: T[]
): T[] {
  return transactions.filter(shouldCountAsExpense);
}

/**
 * Sum the amount * exchangeRate for transactions that count as expenses.
 */
export function sumCountingExpenses(
  transactions: Array<Pick<Transaction, "type" | "category" | "amount" | "exchangeRate">>
): number {
  return transactions
    .filter(shouldCountAsExpense)
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
}
