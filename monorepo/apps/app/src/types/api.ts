/**
cartão de crédito - credit_card
alimentação - food
moradia - housing
transporte - transportation
saúde - health
educação - education
lazer e entretenimento - leisure_entertainment
vestuário e acessórios - clothing_accessories
despesas pessoais - personal_expenses
seguros e previdência - insurance_pensions
investimentos - investments
dívidas e empréstimos - debts_loans
 */

export enum ExpenseCategory {
  CREDIT_CARD = 'CREDIT_CARD',
  FOOD = 'FOOD',
  HOUSING = 'HOUSING',
  TRANSPORTATION = 'TRANSPORTATION',
  HEALTH = 'HEALTH',
  EDUCATION = 'EDUCATION',
  LEISURE_ENTERTAINMENT = 'LEISURE_ENTERTAINMENT',
  CLOTHING_ACCESSORIES = 'CLOTHING_ACCESSORIES',
  PERSONAL_EXPENSES = 'PERSONAL_EXPENSES',
  INSURANCE_PENSIONS = 'INSURANCE_PENSIONS',
  INVESTMENTS = 'INVESTMENTS',
  DEBTS_LOANS = 'DEBTS_LOANS',
  TAXES = 'TAXES',
}

/**
  •	SALARY: Regular income from employment.
	•	BUSINESS: Income from self-employment or business activities.
	•	DIVIDENDS: Earnings from investments in stocks or mutual funds.
	•	INTEREST: Earnings from savings accounts or fixed deposits.
	•	RENTAL: Income from leasing out property or assets.
	•	PENSION: Regular payments from retirement funds.
	•	GIFTS: Monetary gifts or windfalls received.
	•	OTHER: Any miscellaneous income not covered by the above categories.
 */

export enum IncomeCategory {
  SALARY = 'SALARY',
  BUSINESS = 'BUSINESS',
  DIVIDENDS = 'DIVIDENDS',
  INTEREST = 'INTEREST',
  RENTAL = 'RENTAL',
  PENSION = 'PENSION',
  GIFTS = 'GIFTS',
  OTHER = 'OTHER',
}

export type TransactionCategory = ExpenseCategory | IncomeCategory;

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

type Email = {
  id: string;
  sender: string;
  snippet: string;
  internalDate: string;
  pdfNeedsPassword: boolean;
  isPasswordSet: boolean;
  createdAt: string;
};

export type TransactionSubItem = Omit<Transaction, 'subItems'>;

export type Transaction = {
  id: string;
  amount: number;
  description: string;
  type: TransactionType;
  category: TransactionCategory;
  dueAt: string;
  status: string;
  emailId: string | null;
  email?: Email;
  userId: string;
  createdAt: string;
  updatedAt: string;
  subItems: TransactionSubItem[];
};

export type UserTransactionsReponse = {
  transactions: Transaction[];
};
