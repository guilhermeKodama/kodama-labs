import { TransactionCategory } from 'src/types/api';

export const CategoryLabels: { [key in TransactionCategory]: string } = {
  [TransactionCategory.CREDIT_CARD]: 'cartão de crédito',
  [TransactionCategory.FOOD]: 'alimentação',
  [TransactionCategory.HOUSING]: 'moradia',
  [TransactionCategory.TRANSPORTATION]: 'transporte',
  [TransactionCategory.HEALTH]: 'saúde',
  [TransactionCategory.EDUCATION]: 'educação',
  [TransactionCategory.LEISURE_ENTERTAINMENT]: 'lazer e entretenimento',
  [TransactionCategory.CLOTHING_ACCESSORIES]: 'vestuário e acessórios',
  [TransactionCategory.PERSONAL_EXPENSES]: 'despesas pessoais',
  [TransactionCategory.INSURANCE_PENSIONS]: 'seguros e previdência',
  [TransactionCategory.INVESTMENTS]: 'investimentos',
  [TransactionCategory.DEBTS_LOANS]: 'dívidas e empréstimos',
};

export const ShortCategoryLabels: { [key in TransactionCategory]: string } = {
  [TransactionCategory.CREDIT_CARD]: 'cartão de crédito',
  [TransactionCategory.FOOD]: 'alimentação',
  [TransactionCategory.HOUSING]: 'moradia',
  [TransactionCategory.TRANSPORTATION]: 'transporte',
  [TransactionCategory.HEALTH]: 'saúde',
  [TransactionCategory.EDUCATION]: 'educação',
  [TransactionCategory.LEISURE_ENTERTAINMENT]: 'lazer',
  [TransactionCategory.CLOTHING_ACCESSORIES]: 'roupas',
  [TransactionCategory.PERSONAL_EXPENSES]: 'pessoal',
  [TransactionCategory.INSURANCE_PENSIONS]: 'seguros / prev',
  [TransactionCategory.INVESTMENTS]: 'investimentos',
  [TransactionCategory.DEBTS_LOANS]: 'dívidas',
};

export const StatusLabels: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  overdue: 'Vencido',
  draft: 'Rascunho',
};
