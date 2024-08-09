import {
  ExpenseCategory,
  IncomeCategory,
  TransactionCategory,
  TransactionType,
} from 'src/types/api';

export const CategoryLabels: { [key in TransactionCategory]: string } = {
  /**
   * Expense
   */
  [ExpenseCategory.CREDIT_CARD]: 'cartão de crédito',
  [ExpenseCategory.FOOD]: 'alimentação',
  [ExpenseCategory.HOUSING]: 'moradia',
  [ExpenseCategory.TRANSPORTATION]: 'transporte',
  [ExpenseCategory.HEALTH]: 'saúde',
  [ExpenseCategory.EDUCATION]: 'educação',
  [ExpenseCategory.LEISURE_ENTERTAINMENT]: 'lazer e entretenimento',
  [ExpenseCategory.CLOTHING_ACCESSORIES]: 'vestuário e acessórios',
  [ExpenseCategory.PERSONAL_EXPENSES]: 'despesas pessoais',
  [ExpenseCategory.INSURANCE_PENSIONS]: 'seguros e previdência',
  [ExpenseCategory.INVESTMENTS]: 'investimentos',
  [ExpenseCategory.DEBTS_LOANS]: 'dívidas e empréstimos',
  [ExpenseCategory.TAXES]: 'impostos',
  /**
   * Income
   */
  [IncomeCategory.SALARY]: 'salário',
  [IncomeCategory.BUSINESS]: 'lucro negócios',
  [IncomeCategory.DIVIDENDS]: 'dividendos',
  [IncomeCategory.INTEREST]: 'rentabilidade',
  [IncomeCategory.RENTAL]: 'aluguéis',
  [IncomeCategory.PENSION]: 'aposentadoria',
  [IncomeCategory.GIFTS]: 'doação / presente',
  [IncomeCategory.OTHER]: 'outros',
};

export const ShortCategoryLabels: { [key in TransactionCategory]: string } = {
  /**
   * Expense
   */
  [ExpenseCategory.CREDIT_CARD]: 'cartão de crédito',
  [ExpenseCategory.FOOD]: 'alimentação',
  [ExpenseCategory.HOUSING]: 'moradia',
  [ExpenseCategory.TRANSPORTATION]: 'transporte',
  [ExpenseCategory.HEALTH]: 'saúde',
  [ExpenseCategory.EDUCATION]: 'educação',
  [ExpenseCategory.LEISURE_ENTERTAINMENT]: 'lazer',
  [ExpenseCategory.CLOTHING_ACCESSORIES]: 'roupas',
  [ExpenseCategory.PERSONAL_EXPENSES]: 'pessoal',
  [ExpenseCategory.INSURANCE_PENSIONS]: 'seguros / prev',
  [ExpenseCategory.INVESTMENTS]: 'investimentos',
  [ExpenseCategory.DEBTS_LOANS]: 'dívidas',
  [ExpenseCategory.TAXES]: 'impostos',
  /**
   * Income
   */
  [IncomeCategory.SALARY]: 'salário',
  [IncomeCategory.BUSINESS]: 'lucro',
  [IncomeCategory.DIVIDENDS]: 'dividendos',
  [IncomeCategory.INTEREST]: 'rentabilidade',
  [IncomeCategory.RENTAL]: 'aluguéis',
  [IncomeCategory.PENSION]: 'aposentadoria',
  [IncomeCategory.GIFTS]: 'doação',
  [IncomeCategory.OTHER]: 'outros',
};

export const StatusLabels: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  overdue: 'Vencido',
  draft: 'Rascunho',
};

export const TypeLabels: Record<string, string> = {
  [TransactionType.INCOME]: 'Receita',
  [TransactionType.EXPENSE]: 'Despesa',
};

export const ShortTypeLabels: Record<string, string> = {
  [TransactionType.INCOME]: '+',
  [TransactionType.EXPENSE]: '−',
};
