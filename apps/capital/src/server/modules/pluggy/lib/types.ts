/**
 * The slice of Pluggy's documented shapes this sync reads.
 * https://docs.pluggy.ai/docs/products/investment-transactions
 * Amounts on bank transactions are positive; `type` says which way they moved.
 */

export interface PluggyItemPayload {
  id: string;
  status?: string;
  executionStatus?: string;
  consentExpiresAt?: string | null;
  error?: { code?: string; message?: string } | null;
}

export interface PluggyAccount {
  id: string;
  type: string;
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  number?: string | null;
  balance?: number | null;
  currencyCode?: string | null;
  itemId?: string;
}

export interface PluggyTransaction {
  id: string;
  description?: string | null;
  amount: number;
  date: string;
  type: "DEBIT" | "CREDIT" | string;
  currencyCode?: string | null;
  status?: string | null;
  accountId?: string;
}

export interface PluggyInvestment {
  id: string;
  itemId?: string;
  type?: string | null;
  subtype?: string | null;
  name?: string | null;
  code?: string | null;
  quantity?: number | null;
  value?: number | null;
  amount?: number | null;
  balance?: number | null;
  currencyCode?: string | null;
}

export interface PluggyInvestmentTransaction {
  id: string;
  amount: number;
  netAmount?: number | null;
  value?: number | null;
  quantity?: number | null;
  description?: string | null;
  date: string;
  tradeDate?: string | null;
  type: "BUY" | "SELL" | "TAX" | "TRANSFER" | "INTEREST" | "AMORTIZATION" | string;
  expenses?: { incomeTax?: number | null; brokerageFee?: number | null } | null;
}

export interface Page<T> {
  results?: T[];
  page?: number;
  totalPages?: number;
}

export interface PluggyClient {
  getItem(itemId: string): Promise<PluggyItemPayload>;
  getAccounts(itemId: string): Promise<PluggyAccount[]>;
  getTransactions(accountId: string, since: string): Promise<PluggyTransaction[]>;
  getInvestments(itemId: string): Promise<PluggyInvestment[]>;
  getInvestmentTransactions(investmentId: string, since: string): Promise<PluggyInvestmentTransaction[]>;
}
