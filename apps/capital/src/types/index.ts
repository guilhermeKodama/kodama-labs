// ============================================
// CAPITAL - Core TypeScript Types
// ============================================

// --------------------------------------------
// Enums & Constants
// --------------------------------------------

export type EntityType = 'business' | 'personal';

export type TransactionType = 'income' | 'expense' | 'investment';

export type TransferDirection = 'profit_distribution' | 'capital_injection';

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
}

export interface UpdateTransactionInput {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
  category?: string;
  date?: Date;
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
  
  // Actions
  updateSettings: (settings: Partial<AppSettings>) => void;
  addCurrency: (input: CreateCurrencyInput) => void;
  updateCurrencyRate: (code: string, rate: number) => void;
  removeCurrency: (code: string) => void;
  initializePersonalAccount: () => void;
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
