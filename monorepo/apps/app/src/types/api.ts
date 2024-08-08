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

export enum TransactionCategory {
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
}

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

type Email = {
  id: string;
  sender: string;
  snippet: string;
  internalDate: string;
  createdAt: string;
};

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
};

export type UserTransactionsReponse = {
  transactions: Transaction[];
};
