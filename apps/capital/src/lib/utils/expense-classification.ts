import type { Transaction } from "@/types";

/**
 * Determine if a transaction should count as an expense in totals, budgets, and reports.
 *
 * Excludes:
 * - Credit card bill settlement transactions (linked as billPaymentTransactionId in CreditCardStatement)
 *   These are payment transactions that settle a card balance. The actual purchases on the
 *   statement are the real expenses and are counted separately as BillTransactions.
 *
 * This is the single source of truth for "what counts as an expense" across:
 * - Dashboard and report totals
 * - Budget calculations
 * - MCP tool summaries
 * - Any other expense aggregation
 *
 * Design rationale: Credit card purchases are recorded as BillTransactions linked to
 * a CreditCardStatement. When the user pays the bill, that payment transaction is linked
 * to the statement via billPaymentTransactionId. Only transactions that are actually linked
 * as settlements are excluded (not all transactions with category "Credit Card"), so months
 * without imported statements maintain their existing totals.
 *
 * @param transaction - Transaction data including type and isCardSettlement flag
 * @param isCardSettlement - True if this transaction is linked as billPaymentTransactionId
 */
export function shouldCountAsExpense(
  transaction: { type: string },
  isCardSettlement: boolean = false
): boolean {
  if (transaction.type !== "expense") {
    return false;
  }

  // Exclude only transactions that are actually card settlements
  if (isCardSettlement) {
    return false;
  }

  return true;
}

/**
 * Create a Set of transaction IDs that are credit card settlements.
 * Pass this to shouldCountAsExpense when processing transactions.
 */
export function buildSettlementSet(
  statements: Array<{ billPaymentTransactionId: string | null }>
): Set<string> {
  const settlements = new Set<string>();
  for (const stmt of statements) {
    if (stmt.billPaymentTransactionId) {
      settlements.add(stmt.billPaymentTransactionId);
    }
  }
  return settlements;
}

/**
 * Filter an array of transactions to only those that count as expenses.
 */
export function filterCountingExpenses<T extends Pick<Transaction, "type" | "id">>(
  transactions: T[],
  settlementIds: Set<string>
): T[] {
  return transactions.filter((t) => shouldCountAsExpense(t, settlementIds.has(t.id)));
}

/**
 * Sum the amount * exchangeRate for transactions that count as expenses.
 */
export function sumCountingExpenses(
  transactions: Array<Pick<Transaction, "type" | "id" | "amount" | "exchangeRate">>,
  settlementIds: Set<string>
): number {
  return transactions
    .filter((t) => shouldCountAsExpense(t, settlementIds.has(t.id)))
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
}
