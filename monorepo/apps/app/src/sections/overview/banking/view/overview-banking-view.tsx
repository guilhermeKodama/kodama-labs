import Box from '@mui/material/Box';
import Grid from '@mui/material/Unstable_Grid2';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify/iconify';

import type { ExpenseCategory, Transaction, TransactionCategory } from 'src/types/api';
import { TransactionType } from 'src/types/api';
import type { ReactElement } from 'react';
import { useContext, useEffect, useMemo } from 'react';
import { TransactionContext } from 'src/pages/dashboard/invoice/transaction-context';
import { logPageView } from 'src/utils/analytics';
import { BankingExpensesCategories } from '../banking-expenses-categories';
import { BankingBalanceStatistics } from '../banking-balance-statistics';

// ----------------------------------------------------------------------

export type ChartData = {
  name: string;
  data: number[];
};

export type ExpenseCategoryData = {
  label: string;
  value: number;
};

export type TransformedData = {
  weeklySeries: { name: string; data: number[] }[];
  weeklyCategories: string[];
  monthlySeries: { name: string; data: number[] }[];
  monthlyCategories: string[];
  yearlySeries: { name: string; data: number[] }[];
  yearlyCategories: string[];
  expenseSeries: ExpenseCategoryData[];
};

const categoryIcons: { [key in ExpenseCategory]: ReactElement } = {
  CREDIT_CARD: <Iconify icon="mdi:credit-card-outline" />,
  FOOD: <Iconify icon="ion:fast-food" />,
  HOUSING: <Iconify icon="mdi:home-outline" />,
  TRANSPORTATION: <Iconify icon="maki:car" />,
  HEALTH: <Iconify icon="solar:medical-kit-bold" />,
  EDUCATION: <Iconify icon="mdi:school-outline" />,
  LEISURE_ENTERTAINMENT: <Iconify icon="streamline:dices-entertainment-gaming-dices-solid" />,
  CLOTHING_ACCESSORIES: <Iconify icon="mdi:wardrobe-outline" />,
  PERSONAL_EXPENSES: <Iconify icon="mdi:currency-usd-circle-outline" />,
  INSURANCE_PENSIONS: <Iconify icon="mdi:shield-account-outline" />,
  INVESTMENTS: <Iconify icon="mdi:finance" />,
  DEBTS_LOANS: <Iconify icon="mdi:account-cash-outline" />,
  TAXES: <Iconify icon="bi:receipt-cutoff" />,
};

const groupBy = (arr: any[], key: string) =>
  arr.reduce((acc, item) => {
    const group = item[key];
    acc[group] = acc[group] || [];
    acc[group].push(item);
    return acc;
  }, {});

const sumByType = (transactions: Transaction[], type: TransactionType) =>
  transactions
    .filter((transaction) => transaction.type === type)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

const sumByCategory = (transactions: Transaction[], category: TransactionCategory) =>
  transactions
    .filter((transaction) => transaction.category === category)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

const getWeek = (dateStr: string) => {
  const date = new Date(dateStr);
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.valueOf() - firstDayOfYear.valueOf()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
};

const getMonth = (dateStr: string) => new Date(dateStr).getMonth();
const getYear = (dateStr: string) => new Date(dateStr).getFullYear();

const getExpenseSeriesWithIcons = (expenseSeries: ExpenseCategoryData[]) => ({
  series: expenseSeries,
  icons: expenseSeries.map((item) => categoryIcons[item.label as ExpenseCategory]),
});

const flattenTransactions = (transactions: Transaction[]): Transaction[] => {
  const flattened: Transaction[] = [];

  transactions.forEach((transaction) => {
    if (transaction.subItems && transaction.subItems.length > 0) {
      // Add all subItems as separate transactions
      flattened.push(
        ...transaction.subItems.map((subItem) => ({
          ...subItem,
          type: transaction.type, // inherit type from parent
          category: subItem.category || transaction.category, // inherit category if not set
          dueAt: transaction.dueAt, // inherit dueAt from parent\
          subItems: [],
        }))
      );
    } else {
      // If no subItems, add the transaction itself
      flattened.push(transaction);
    }
  });

  return flattened;
};

const transformTransactions = (transactions: Transaction[]): TransformedData => {
  const flattenedTransactions = flattenTransactions(transactions);

  const transactionsWithKeys = flattenedTransactions.map((transaction) => ({
    ...transaction,
    week: getWeek(transaction.dueAt),
    month: getMonth(transaction.dueAt),
    year: getYear(transaction.dueAt),
  }));

  const groupedByWeek = groupBy(transactionsWithKeys, 'week');
  const groupedByMonth = groupBy(transactionsWithKeys, 'month');
  const groupedByYear = groupBy(transactionsWithKeys, 'year');

  const weeklyCategories = Object.keys(groupedByWeek).map((week) => `Week ${week}`);
  const monthlyCategories = Object.keys(groupedByMonth).map((month) =>
    new Date(0, parseInt(month, 10)).toLocaleString('default', { month: 'short' })
  );
  const yearlyCategories = Object.keys(groupedByYear);

  const transformData = (data: Record<number, Transaction[]>, type: TransactionType) => {
    const transactionsMatrix = Object.values(data);

    const transactionMatrixSum = transactionsMatrix.map((transactions) =>
      sumByType(transactions, type)
    );

    return transactionMatrixSum;
  };

  const weeklySeries = [
    { name: 'Receitas', data: transformData(groupedByWeek, TransactionType.INCOME) },
    { name: 'Despesas', data: transformData(groupedByWeek, TransactionType.EXPENSE) },
  ];
  const monthlySeries = [
    { name: 'Receitas', data: transformData(groupedByMonth, TransactionType.INCOME) },
    { name: 'Despesas', data: transformData(groupedByMonth, TransactionType.EXPENSE) },
  ];
  const yearlySeries = [
    { name: 'Receitas', data: transformData(groupedByYear, TransactionType.INCOME) },
    { name: 'Despesas', data: transformData(groupedByYear, TransactionType.EXPENSE) },
  ];

  const expenseTransactions = flattenedTransactions.filter(
    (transaction) => transaction.type === TransactionType.EXPENSE
  );
  const groupedByCategory = groupBy(expenseTransactions, 'category');
  const expenseSeries: ExpenseCategoryData[] = Object.keys(groupedByCategory).map((category) => ({
    label: category,
    value: sumByCategory(expenseTransactions, category as TransactionCategory),
  }));

  return {
    weeklySeries,
    weeklyCategories,
    monthlySeries,
    monthlyCategories,
    yearlySeries,
    yearlyCategories,
    expenseSeries,
  };
};

export function OverviewBankingView() {
  useEffect(() => {
    // Registra uma nova visita de página a cada mudança de rota
    logPageView(window.location.pathname);
  }, []);

  const { transactions } = useContext(TransactionContext);

  const {
    weeklySeries,
    weeklyCategories,
    monthlySeries,
    monthlyCategories,
    yearlySeries,
    yearlyCategories,
    expenseSeries,
  } = useMemo<TransformedData>(() => transformTransactions(transactions), [transactions]);

  const expenseSeriesWithIcons = getExpenseSeriesWithIcons(expenseSeries);

  return (
    <DashboardContent maxWidth="xl">
      <Grid xs={12} md={7} lg={8}>
        <Box sx={{ gap: 3, display: 'flex', flexDirection: 'column' }}>
          {/* <BankingOverview /> */}

          <BankingBalanceStatistics
            title="Fluxo de caixa"
            subheader="Estatísticas de receitas vs despesas"
            chart={{
              series: [
                {
                  name: 'Semanal',
                  categories: weeklyCategories,
                  data: weeklySeries,
                },
                {
                  name: 'Mensal',
                  categories: monthlyCategories,
                  data: monthlySeries,
                },
                {
                  name: 'Anual',
                  categories: yearlyCategories,
                  data: yearlySeries,
                },
              ],
            }}
          />

          <BankingExpensesCategories
            title="Despesas por categoria"
            total={expenseSeries.reduce((sum, item) => sum + item.value, 0)}
            categoriesTotal={expenseSeries.length}
            chart={expenseSeriesWithIcons}
          />
        </Box>
      </Grid>
    </DashboardContent>
  );
}
