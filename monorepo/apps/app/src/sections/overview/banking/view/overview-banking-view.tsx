import Box from '@mui/material/Box';
import Grid from '@mui/material/Unstable_Grid2';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify/iconify';

import { BankingOverview } from '../banking-overview';
import { BankingBalanceStatistics } from '../banking-balance-statistics';
import { BankingExpensesCategories } from '../banking-expenses-categories';
import { Transaction, TransactionCategory, TransactionType } from 'src/types/api';
import { useContext, useMemo } from 'react';
import { TransactionContext } from 'src/pages/dashboard/invoice/transaction-context';

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

const transformTransactions = (transactions: Transaction[]): TransformedData => {
  const transactionsWithKeys = transactions.map((transaction) => ({
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
    new Date(0, parseInt(month)).toLocaleString('default', { month: 'short' })
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
    { name: 'Income', data: transformData(groupedByWeek, TransactionType.INCOME) },
    { name: 'Expense', data: transformData(groupedByWeek, TransactionType.EXPENSE) },
  ];
  const monthlySeries = [
    { name: 'Income', data: transformData(groupedByMonth, TransactionType.INCOME) },
    { name: 'Expense', data: transformData(groupedByMonth, TransactionType.EXPENSE) },
  ];
  const yearlySeries = [
    { name: 'Income', data: transformData(groupedByYear, TransactionType.INCOME) },
    { name: 'Expense', data: transformData(groupedByYear, TransactionType.EXPENSE) },
  ];

  const expenseTransactions = transactions.filter(
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

  console.log({ expenseSeries });

  return (
    <DashboardContent maxWidth="xl">
      <Grid xs={12} md={7} lg={8}>
        <Box sx={{ gap: 3, display: 'flex', flexDirection: 'column' }}>
          {/* <BankingOverview /> */}

          <BankingBalanceStatistics
            title="Fluxo de caixa"
            subheader="Estatísticas de renda vs gastos"
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
            chart={{
              series: expenseSeries,
              icons: [
                <Iconify icon="ion:fast-food" />, // Food
                <Iconify icon="mdi:home-outline" />, // Housing
                <Iconify icon="maki:car" />, // Transportation
                <Iconify icon="solar:medical-kit-bold" />, // Health
                <Iconify icon="mdi:school-outline" />, // Education
                <Iconify icon="streamline:dices-entertainment-gaming-dices-solid" />, // Leisure_Entertainment
                <Iconify icon="mdi:wardrobe-outline" />, // Clothing_Accessories
                <Iconify icon="mdi:currency-usd-circle-outline" />, // Personal_Expenses
                <Iconify icon="mdi:shield-account-outline" />, // Insurance_Pensions
                <Iconify icon="mdi:finance" />, // Investments
                <Iconify icon="mdi:account-cash-outline" />, // Debts_Loans
                <Iconify icon="mdi:credit-card-outline" />, // Credit_Card
              ],
            }}
          />
        </Box>
      </Grid>
    </DashboardContent>
  );
}
