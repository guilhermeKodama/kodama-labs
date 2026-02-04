// ============================================
// CAPITAL - Core TypeScript Types
// ============================================

// --------------------------------------------
// Enums & Constants
// --------------------------------------------

export type EntityType = 'business' | 'personal';

export type TransactionType = 'income' | 'expense' | 'investment';

export type TransferDirection = 'profit_distribution' | 'capital_injection';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type BudgetPeriod = 'monthly' | 'yearly';

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  investment: 'Investment',
};

export const TRANSFER_DIRECTION_LABELS: Record<TransferDirection, string> = {
  profit_distribution: 'Profit Distribution',
  capital_injection: 'Capital Injection',
};

// --------------------------------------------
// User
// --------------------------------------------

export interface User {
  id: string;
  name: string;
  email: string;
  baseCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

// --------------------------------------------
// Business
// --------------------------------------------

export interface Business {
  id: string;
  userId: string;
  name: string;
  description?: string;
  defaultCurrency: string;
  color?: string; // For UI differentiation
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBusinessInput {
  name: string;
  description?: string;
  defaultCurrency: string;
  color?: string;
}

export interface UpdateBusinessInput {
  name?: string;
  description?: string;
  defaultCurrency?: string;
  color?: string;
}

// --------------------------------------------
// Personal Account
// --------------------------------------------

export interface PersonalAccount {
  id: string;
  userId: string;
  defaultCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

// --------------------------------------------
// Transaction
// --------------------------------------------

export interface Transaction {
  id: string;
  entityId: string;
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate: number; // Rate to convert to base currency
  description: string;
  category: string;
  date: Date;
  isTaxDeductible?: boolean; // For tax calculation helpers
  recurringTransactionId?: string; // Link to recurring transaction if auto-generated
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTransactionInput {
  entityId: string;
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description: string;
  category: string;
  date: Date;
  isTaxDeductible?: boolean;
  recurringTransactionId?: string;
}

export interface UpdateTransactionInput {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  date?: Date;
  isTaxDeductible?: boolean;
}

// --------------------------------------------
// Transfer
// --------------------------------------------

export interface Transfer {
  id: string;
  fromEntityId: string;
  fromEntityType: EntityType;
  toEntityId: string;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTransferInput {
  fromEntityId: string;
  fromEntityType: EntityType;
  toEntityId: string;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description?: string;
  date: Date;
}

// --------------------------------------------
// Recurring Transaction
// --------------------------------------------

export interface RecurringTransaction {
  id: string;
  entityId: string;
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate: number;
  description: string;
  category: string;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
  nextDueDate: Date;
  lastGeneratedDate?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecurringTransactionInput {
  entityId: string;
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description: string;
  category: string;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
}

export interface UpdateRecurringTransactionInput {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  frequency?: RecurrenceFrequency;
  startDate?: Date;
  endDate?: Date;
  isActive?: boolean;
}

// --------------------------------------------
// Budget
// --------------------------------------------

export interface Budget {
  id: string;
  entityId: string;
  entityType: EntityType;
  category: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  year: number;
  month?: number; // 1-12 for monthly budgets
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBudgetInput {
  entityId: string;
  entityType: EntityType;
  category: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  year: number;
  month?: number;
}

export interface UpdateBudgetInput {
  category?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  year?: number;
  month?: number;
  isActive?: boolean;
}

export interface BudgetProgress {
  budget: Budget;
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
}

// --------------------------------------------
// Tax
// --------------------------------------------

export interface TaxSettings {
  taxYear: number;
  entityTaxRates: Record<string, number>; // entityId -> tax rate %
}

export interface TaxSummary {
  entityId: string;
  entityName: string;
  totalIncome: number;
  totalDeductible: number;
  taxableIncome: number;
  estimatedTax: number;
  taxRate: number;
}

// --------------------------------------------
// Currency
// --------------------------------------------

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  manualRate: number; // Rate relative to base currency (1 base = X this currency)
  updatedAt: Date;
}

export interface CreateCurrencyInput {
  code: string;
  name: string;
  symbol: string;
  manualRate: number;
}

// --------------------------------------------
// Category
// --------------------------------------------

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  color?: string;
  icon?: string;
}

// Default categories
export const DEFAULT_INCOME_CATEGORIES = [
  'Client Payment',
  'Salary',
  'Dividends',
  'Interest',
  'Refund',
  'Other Income',
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Software & Tools',
  'Hardware',
  'Office',
  'Travel',
  'Marketing',
  'Legal & Accounting',
  'Taxes',
  'Insurance',
  'Utilities',
  'Other Expense',
];

export const DEFAULT_INVESTMENT_CATEGORIES = [
  'Stocks',
  'Bonds',
  'Crypto',
  'Real Estate',
  'Savings',
  'Retirement',
  'Other Investment',
];

// --------------------------------------------
// Computed Types (for UI)
// --------------------------------------------

export interface EntitySummary {
  entityId: string;
  entityType: EntityType;
  entityName: string;
  totalIncome: number;
  totalExpenses: number;
  totalInvestments: number;
  balance: number; // income - expenses
  netWorth: number; // balance + investments value
  currency: string;
}

export interface TransactionWithEntity extends Transaction {
  entityName: string;
}

export interface TransferWithEntities extends Transfer {
  fromEntityName: string;
  toEntityName: string;
}

// --------------------------------------------
// Settings
// --------------------------------------------

export interface AppSettings {
  userId: string;
  baseCurrency: string;
  theme: 'light' | 'dark' | 'system';
  dateFormat: string;
  numberFormat: 'en-US' | 'pt-BR' | 'de-DE';
}

// --------------------------------------------
// Store State Types
// --------------------------------------------

export interface BusinessStore {
  businesses: Business[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  addBusiness: (input: CreateBusinessInput) => Business;
  updateBusiness: (id: string, input: UpdateBusinessInput) => void;
  deleteBusiness: (id: string) => void;
  getBusiness: (id: string) => Business | undefined;
}

export interface TransactionStore {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  addTransaction: (input: CreateTransactionInput) => Transaction;
  updateTransaction: (id: string, input: UpdateTransactionInput) => void;
  deleteTransaction: (id: string) => void;
  getTransactionsByEntity: (entityId: string, entityType: EntityType) => Transaction[];
  getTransactionsByType: (type: TransactionType) => Transaction[];
}

export interface TransferStore {
  transfers: Transfer[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  addTransfer: (input: CreateTransferInput) => Transfer;
  deleteTransfer: (id: string) => void;
  getTransfersByEntity: (entityId: string) => Transfer[];
}

export interface SettingsStore {
  settings: AppSettings;
  currencies: Currency[];
  categories: Category[];
  personalAccount: PersonalAccount | null;
  taxSettings: TaxSettings;
  
  // Actions
  updateSettings: (settings: Partial<AppSettings>) => void;
  addCurrency: (input: CreateCurrencyInput) => void;
  updateCurrencyRate: (code: string, rate: number) => void;
  removeCurrency: (code: string) => void;
  initializePersonalAccount: () => void;
  updateTaxSettings: (settings: Partial<TaxSettings>) => void;
  setEntityTaxRate: (entityId: string, rate: number) => void;
}

export interface RecurringTransactionStore {
  recurringTransactions: RecurringTransaction[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  addRecurringTransaction: (input: CreateRecurringTransactionInput) => RecurringTransaction;
  updateRecurringTransaction: (id: string, input: UpdateRecurringTransactionInput) => void;
  deleteRecurringTransaction: (id: string) => void;
  toggleRecurringTransaction: (id: string) => void;
  getRecurringTransactionsByEntity: (entityId: string, entityType: EntityType) => RecurringTransaction[];
  updateLastGeneratedDate: (id: string, date: Date) => void;
}

export interface BudgetStore {
  budgets: Budget[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  addBudget: (input: CreateBudgetInput) => Budget;
  updateBudget: (id: string, input: UpdateBudgetInput) => void;
  deleteBudget: (id: string) => void;
  toggleBudget: (id: string) => void;
  getBudgetsByEntity: (entityId: string, entityType: EntityType) => Budget[];
  getBudgetsByPeriod: (year: number, month?: number) => Budget[];
}

// --------------------------------------------
// API Response Types (for future backend)
// --------------------------------------------

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// --------------------------------------------
// Filter & Sort Types
// --------------------------------------------

export interface TransactionFilters {
  entityId?: string;
  entityType?: EntityType;
  type?: TransactionType;
  category?: string;
  currency?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
}

export type SortDirection = 'asc' | 'desc';

export interface SortConfig<T> {
  field: keyof T;
  direction: SortDirection;
}
