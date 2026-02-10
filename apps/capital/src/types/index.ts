// ============================================
// CAPITAL - Core TypeScript Types
// ============================================

// --------------------------------------------
// Enums & Constants
// --------------------------------------------

export type EntityType = 'business' | 'personal';

export type TransactionType = 'income' | 'expense' | 'investment';

export type TransferDirection = 'profit_distribution' | 'capital_injection' | 'reimbursement';

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
  reimbursement: 'Reimbursement',
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
// Recurring Transfer
// --------------------------------------------

export interface RecurringTransfer {
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
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
  nextDueDate: Date;
  lastGeneratedDate?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecurringTransferInput {
  fromEntityId: string;
  fromEntityType: EntityType;
  toEntityId: string;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description?: string;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
}

export interface UpdateRecurringTransferInput {
  direction?: TransferDirection;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string;
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
  alertThreshold?: number; // Percentage (0-100) at which to warn, default 80
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
  alertThreshold?: number;
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

export interface BudgetPace {
  dailySpendRate: number;
  allowedDailyRate: number;
  projectedTotal: number;
  isOverPace: boolean;
  daysElapsed: number;
  daysRemaining: number;
  daysInPeriod: number;
}

export interface UnbudgetedCategory {
  category: string;
  totalSpent: number;
  transactionCount: number;
  entityId: string;
  entityType: EntityType;
  isFromPreviousMonth?: boolean;
}

export interface MonthOverMonth {
  category: string;
  entityId: string;
  currentSpent: number;
  previousSpent: number;
  changeAmount: number;
  changePercent: number;
}

export interface YearlyMonthBreakdown {
  month: number; // 1-12
  monthLabel: string;
  budgetTarget: number; // yearly amount / 12
  actual: number;
  cumulativeBudget: number;
  cumulativeActual: number;
  isOver: boolean;
}

export interface YearlyBudgetProgress {
  budget: Budget;
  monthlyTarget: number; // amount / 12
  ytdBudget: number;
  ytdSpent: number;
  ytdRemaining: number;
  ytdPercentUsed: number;
  isYtdOver: boolean;
  projectedAnnual: number;
  months: YearlyMonthBreakdown[];
}

export interface YearlySummaryStats {
  totalAnnualBudget: number;
  totalYtdSpent: number;
  totalAnnualRoom: number;
  projectedAnnualTotal: number;
  monthsElapsed: number;
  isOnTrack: boolean;
}

export type BudgetInsightSeverity = 'critical' | 'warning' | 'good';

export interface BudgetInsight {
  budgetId: string;
  category: string;
  severity: BudgetInsightSeverity;
  message: string;
  recommendation: string;
  percentUsed: number;
  remaining: number;
  daysRemaining: number;
  dailySpendRate: number;
  allowedDailyRate: number;
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
  isSystem?: boolean;
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
  'FII',
  'ETF',
  'BDR',
  'Fixed Income',
  'Crypto',
  'International Stocks',
  'International ETF',
  'Savings',
  'Other Investment',
];

// System expense categories for credit cards - cannot be deleted
export const SYSTEM_EXPENSE_CATEGORIES = [
  'Credit Card',
  'Subscriptions',
  'Groceries',
  'Restaurants & Dining',
  'Transportation',
  'Shopping',
  'Entertainment',
  'Health & Pharmacy',
  'Travel',
  'Education',
  'Personal Care',
  'Home',
  'Fees & Charges',
  'Other',
];

// --------------------------------------------
// Credit Card
// --------------------------------------------

export type BillStatus = 'pending' | 'paid' | 'overdue';

export interface CreditCard {
  id: string;
  entityId: string;
  entityType: EntityType;
  bankName: string;
  lastFourDigits: string;
  nickname?: string;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  color: string;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCreditCardInput {
  entityType: EntityType;
  bankName: string;
  lastFourDigits: string;
  nickname?: string;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  color?: string;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

export interface UpdateCreditCardInput {
  bankName?: string;
  lastFourDigits?: string;
  nickname?: string;
  creditLimit?: number;
  closingDay?: number;
  dueDay?: number;
  color?: string;
  currency?: string;
  isActive?: boolean;
}

export type CategorizationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface CreditCardBill {
  id: string;
  creditCardId: string;
  transactionId?: string;
  closingDate: Date;
  dueDate: Date;
  totalAmount: number;
  status: BillStatus;
  categorizationStatus: CategorizationStatus;
  csvFileName?: string;
  creditCard?: {
    id: string;
    bankName: string;
    lastFourDigits: string;
    nickname?: string;
    color: string;
  };
  transactionCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillTransaction {
  id: string;
  billId: string;
  category: string;
  transactionDate: Date;
  description: string;
  merchantName?: string;
  amount: number;
  installmentNumber?: number;
  totalInstallments?: number;
  isAutoCategorized: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Installment {
  id: string;
  creditCardId: string;
  billTransactionId: string;
  description: string;
  category?: string;
  totalAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingInstallments: number;
  startDate: Date;
  installmentAmount: number;
  isActive: boolean;
  creditCard?: {
    id: string;
    bankName: string;
    lastFourDigits: string;
    nickname?: string;
    color: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface BillUploadResult {
  bill: {
    id: string;
    creditCardId: string;
    closingDate: Date;
    dueDate: Date;
    totalAmount: number;
    status: BillStatus;
    categorizationStatus: CategorizationStatus;
  };
  totalAmount: number;
  transactionCount: number;
  replaced: boolean;
}

// --------------------------------------------
// Investment Portfolio
// --------------------------------------------

export type AssetClass =
  | 'stocks'
  | 'fii'
  | 'etf'
  | 'bdr'
  | 'fixed_income'
  | 'crypto'
  | 'savings'
  | 'international_stocks'
  | 'international_etf';

export type FixedIncomeSubType =
  | 'cdb'
  | 'rdb'
  | 'lci'
  | 'lca'
  | 'cdi'
  | 'tesouro_selic'
  | 'tesouro_ipca'
  | 'tesouro_prefixado'
  | 'debenture';

export type InvestmentTransactionType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'yield_payment'
  | 'split'
  | 'deposit'
  | 'withdrawal';

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  stocks: 'Stocks',
  fii: 'FII',
  etf: 'ETF',
  bdr: 'BDR',
  fixed_income: 'Fixed Income',
  crypto: 'Crypto',
  savings: 'Savings',
  international_stocks: 'International Stocks',
  international_etf: 'International ETF',
};

export const FIXED_INCOME_SUBTYPE_LABELS: Record<FixedIncomeSubType, string> = {
  cdb: 'CDB',
  rdb: 'RDB',
  lci: 'LCI',
  lca: 'LCA',
  cdi: 'CDI',
  tesouro_selic: 'Tesouro Selic',
  tesouro_ipca: 'Tesouro IPCA+',
  tesouro_prefixado: 'Tesouro Prefixado',
  debenture: 'Debênture',
};

export const INVESTMENT_TRANSACTION_TYPE_LABELS: Record<InvestmentTransactionType, string> = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  yield_payment: 'Yield',
  split: 'Split',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
};

// Asset classes that require a ticker symbol
export const TICKER_ASSET_CLASSES: AssetClass[] = [
  'stocks',
  'fii',
  'etf',
  'bdr',
  'crypto',
  'international_stocks',
  'international_etf',
];

// Asset classes that require price per unit
export const PRICE_PER_UNIT_ASSET_CLASSES: AssetClass[] = [
  'stocks',
  'fii',
  'etf',
  'bdr',
  'crypto',
  'international_stocks',
  'international_etf',
];

export interface InvestmentAccount {
  id: string;
  userId: string;
  name: string;
  broker?: string;
  entityId: string; // businessId or personalAccountId
  entityType: EntityType;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvestmentAccountInput {
  name: string;
  broker?: string;
  entityType: EntityType;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

export interface UpdateInvestmentAccountInput {
  name?: string;
  broker?: string;
  currency?: string;
  isActive?: boolean;
}

export interface InvestmentHolding {
  id: string;
  accountId: string;
  assetClass: AssetClass;
  subType?: FixedIncomeSubType;
  ticker?: string;
  name: string;
  currency: string;
  currentQuantity: number;
  averageCost: number;
  totalInvested: number;
  currentPrice?: number;
  lastPriceUpdate?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Enriched from joins
  account?: Pick<InvestmentAccount, 'id' | 'name' | 'broker' | 'entityType'>;
}

export interface CreateInvestmentHoldingInput {
  accountId: string;
  assetClass: AssetClass;
  subType?: FixedIncomeSubType;
  ticker?: string;
  name: string;
  currency: string;
}

export interface UpdateInvestmentHoldingInput {
  name?: string;
  ticker?: string;
  assetClass?: AssetClass;
  subType?: FixedIncomeSubType;
  currency?: string;
  isActive?: boolean;
}

export interface InvestmentTransaction {
  id: string;
  holdingId: string;
  type: InvestmentTransactionType;
  quantity?: number;
  pricePerUnit?: number;
  totalAmount: number;
  fees: number;
  date: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  // Enriched from joins
  holding?: Pick<InvestmentHolding, 'id' | 'name' | 'ticker' | 'assetClass'>;
}

export interface CreateInvestmentTransactionInput {
  holdingId: string;
  type: InvestmentTransactionType;
  quantity?: number;
  pricePerUnit?: number;
  totalAmount: number;
  fees?: number;
  date: Date;
  notes?: string;
}

export interface UpdateInvestmentTransactionInput {
  type?: InvestmentTransactionType;
  quantity?: number;
  pricePerUnit?: number;
  totalAmount?: number;
  fees?: number;
  date?: Date;
  notes?: string;
}

export interface PortfolioSummary {
  totalInvested: number;
  totalByAssetClass: Record<AssetClass, number>;
  holdingsCount: number;
  accountsCount: number;
}

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
  timezone: string;
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
