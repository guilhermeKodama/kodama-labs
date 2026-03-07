import { describe, it, expect } from 'vitest';
import type { Transaction, Transfer, EntitySummary } from '@/types';
import {
  sumTransactionsByType,
  sumReimbursementExpenses,
  sumReimbursementCredits,
  sumInvestmentDeposits,
  sumInvestmentWithdrawals,
  sumProfitDistributions,
  sumInvestmentCategoryExpenses,
  calculateEntitySummary,
  calculateTotalCapital,
  calculateMonthlyTotals,
  calculateCategoryBreakdown,
  calculateGrowthRate,
  calculateYearlyTotals,
} from '../calculations';

// ============================================================
// Fixture factories
// ============================================================

const PERSONAL_ID = 'personal-1';
const BUSINESS_ID = 'business-1';
const INVESTMENT_ID = 'invest-1';

let _seq = 0;

function mkTx(overrides: Partial<Transaction> = {}): Transaction {
  _seq++;
  return {
    id: `tx-${_seq}`,
    entityId: PERSONAL_ID,
    entityType: 'personal',
    type: 'expense',
    amount: 100,
    currency: 'BRL',
    exchangeRate: 1,
    description: '',
    category: 'General',
    date: new Date('2026-01-15'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mkTransfer(overrides: Partial<Transfer> = {}): Transfer {
  _seq++;
  return {
    id: `tr-${_seq}`,
    fromEntityId: BUSINESS_ID,
    fromEntityType: 'business',
    toEntityId: PERSONAL_ID,
    toEntityType: 'personal',
    direction: 'reimbursement',
    amount: 100,
    currency: 'BRL',
    exchangeRate: 1,
    date: new Date('2026-01-15'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ============================================================
// sumTransactionsByType
// ============================================================

describe('sumTransactionsByType', () => {
  it('sums only matching type', () => {
    const txs = [
      mkTx({ type: 'income', amount: 1000 }),
      mkTx({ type: 'expense', amount: 500 }),
      mkTx({ type: 'income', amount: 2000 }),
    ];
    expect(sumTransactionsByType(txs, 'income')).toBe(3000);
    expect(sumTransactionsByType(txs, 'expense')).toBe(500);
    expect(sumTransactionsByType(txs, 'investment')).toBe(0);
  });

  it('applies amount * exchangeRate', () => {
    const txs = [
      mkTx({ type: 'income', amount: 100, exchangeRate: 5.5 }),
      mkTx({ type: 'income', amount: 200, exchangeRate: 0.5 }),
    ];
    expect(sumTransactionsByType(txs, 'income')).toBe(100 * 5.5 + 200 * 0.5);
  });

  it('returns 0 for empty array', () => {
    expect(sumTransactionsByType([], 'income')).toBe(0);
  });
});

// ============================================================
// sumReimbursementExpenses
// ============================================================

describe('sumReimbursementExpenses', () => {
  const transfers = [
    mkTransfer({ fromEntityId: BUSINESS_ID, direction: 'reimbursement', amount: 300 }),
    mkTransfer({ fromEntityId: BUSINESS_ID, direction: 'reimbursement', amount: 200 }),
    mkTransfer({ fromEntityId: 'other-biz', direction: 'reimbursement', amount: 150 }),
    mkTransfer({ fromEntityId: BUSINESS_ID, direction: 'profit_distribution', amount: 999 }),
  ];

  it('sums all reimbursements without entityId filter', () => {
    expect(sumReimbursementExpenses(transfers)).toBe(300 + 200 + 150);
  });

  it('filters by fromEntityId when provided', () => {
    expect(sumReimbursementExpenses(transfers, BUSINESS_ID)).toBe(300 + 200);
  });

  it('returns 0 when no reimbursements', () => {
    expect(sumReimbursementExpenses([
      mkTransfer({ direction: 'profit_distribution', amount: 500 }),
    ])).toBe(0);
  });
});

// ============================================================
// sumReimbursementCredits
// ============================================================

describe('sumReimbursementCredits', () => {
  const transfers = [
    mkTransfer({ toEntityId: PERSONAL_ID, direction: 'reimbursement', amount: 400 }),
    mkTransfer({ toEntityId: PERSONAL_ID, direction: 'reimbursement', amount: 100 }),
    mkTransfer({ toEntityId: 'other-personal', direction: 'reimbursement', amount: 50 }),
  ];

  it('sums all reimbursement credits without entityId filter', () => {
    expect(sumReimbursementCredits(transfers)).toBe(400 + 100 + 50);
  });

  it('filters by toEntityId when provided', () => {
    expect(sumReimbursementCredits(transfers, PERSONAL_ID)).toBe(400 + 100);
  });
});

// ============================================================
// sumInvestmentDeposits
// ============================================================

describe('sumInvestmentDeposits', () => {
  const transfers = [
    mkTransfer({ fromEntityId: PERSONAL_ID, direction: 'investment_deposit', amount: 5000 }),
    mkTransfer({ fromEntityId: PERSONAL_ID, direction: 'investment_deposit', amount: 3000 }),
    mkTransfer({ fromEntityId: BUSINESS_ID, direction: 'investment_deposit', amount: 2000 }),
    mkTransfer({ direction: 'reimbursement', amount: 999 }),
  ];

  it('sums all deposits without filter', () => {
    expect(sumInvestmentDeposits(transfers)).toBe(5000 + 3000 + 2000);
  });

  it('filters by fromEntityId', () => {
    expect(sumInvestmentDeposits(transfers, PERSONAL_ID)).toBe(5000 + 3000);
  });
});

// ============================================================
// sumInvestmentWithdrawals
// ============================================================

describe('sumInvestmentWithdrawals', () => {
  const transfers = [
    mkTransfer({ toEntityId: PERSONAL_ID, direction: 'investment_withdrawal', amount: 1000 }),
    mkTransfer({ toEntityId: BUSINESS_ID, direction: 'investment_withdrawal', amount: 2000 }),
  ];

  it('sums all withdrawals without filter', () => {
    expect(sumInvestmentWithdrawals(transfers)).toBe(3000);
  });

  it('filters by toEntityId', () => {
    expect(sumInvestmentWithdrawals(transfers, PERSONAL_ID)).toBe(1000);
  });
});

// ============================================================
// sumProfitDistributions
// ============================================================

describe('sumProfitDistributions', () => {
  const transfers = [
    mkTransfer({
      fromEntityId: BUSINESS_ID,
      toEntityId: PERSONAL_ID,
      direction: 'profit_distribution',
      amount: 10000,
    }),
    mkTransfer({
      fromEntityId: BUSINESS_ID,
      toEntityId: PERSONAL_ID,
      direction: 'profit_distribution',
      amount: 5000,
    }),
  ];

  it('sums from side (business outgoing)', () => {
    expect(sumProfitDistributions(transfers, 'from')).toBe(15000);
    expect(sumProfitDistributions(transfers, 'from', BUSINESS_ID)).toBe(15000);
  });

  it('sums to side (personal incoming)', () => {
    expect(sumProfitDistributions(transfers, 'to')).toBe(15000);
    expect(sumProfitDistributions(transfers, 'to', PERSONAL_ID)).toBe(15000);
  });

  it('returns 0 for non-matching entity', () => {
    expect(sumProfitDistributions(transfers, 'from', 'unknown')).toBe(0);
  });
});

// ============================================================
// sumInvestmentCategoryExpenses
// ============================================================

describe('sumInvestmentCategoryExpenses', () => {
  it('only counts expenses with Investment category', () => {
    const txs = [
      mkTx({ type: 'expense', category: 'Investment', amount: 5000 }),
      mkTx({ type: 'expense', category: 'Food', amount: 200 }),
      mkTx({ type: 'income', category: 'Investment', amount: 1000 }),
    ];
    expect(sumInvestmentCategoryExpenses(txs)).toBe(5000);
  });

  it('returns 0 with no matching transactions', () => {
    expect(sumInvestmentCategoryExpenses([])).toBe(0);
  });
});

// ============================================================
// calculateEntitySummary -- Personal
// ============================================================

describe('calculateEntitySummary (personal)', () => {
  it('income only', () => {
    const txs = [mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'income', amount: 5000 })];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, [], 'BRL');
    expect(result.totalIncome).toBe(5000);
    expect(result.totalExpenses).toBe(0);
    expect(result.balance).toBe(5000);
  });

  it('expenses only', () => {
    const txs = [mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'expense', amount: 3000 })];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, [], 'BRL');
    expect(result.totalExpenses).toBe(3000);
    expect(result.balance).toBe(-3000);
  });

  it('reimbursement credits reduce expenses and are NOT in incoming transfers', () => {
    const txs = [
      mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'expense', amount: 1000 }),
    ];
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'reimbursement',
        amount: 400,
      }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, trs, 'BRL');

    expect(result.totalExpenses).toBe(600);
    // Balance should be -600, NOT -600 + 400 = -200 (the old double-count bug)
    expect(result.balance).toBe(-600);
  });

  it('profit distributions incoming increase balance', () => {
    const txs = [mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'expense', amount: 2000 })];
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'profit_distribution',
        amount: 5000,
      }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, trs, 'BRL');
    expect(result.balance).toBe(-2000 + 5000);
  });

  it('investment deposit outgoing decreases balance', () => {
    const txs = [mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'income', amount: 10000 })];
    const trs = [
      mkTransfer({
        fromEntityId: PERSONAL_ID,
        toEntityId: INVESTMENT_ID,
        direction: 'investment_deposit',
        amount: 3000,
      }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, trs, 'BRL');
    expect(result.balance).toBe(10000 - 3000);
  });

  it('investment withdrawal incoming increases balance', () => {
    const trs = [
      mkTransfer({
        fromEntityId: INVESTMENT_ID,
        toEntityId: PERSONAL_ID,
        direction: 'investment_withdrawal',
        amount: 2000,
      }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', [], trs, 'BRL');
    expect(result.balance).toBe(2000);
  });

  it('full mixed scenario matching production data pattern', () => {
    const txs = [
      mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'expense', amount: 153341.78 }),
    ];
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'reimbursement',
        amount: 33127.21,
      }),
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'profit_distribution',
        amount: 133971.51,
      }),
      mkTransfer({
        fromEntityId: INVESTMENT_ID,
        toEntityId: PERSONAL_ID,
        direction: 'investment_withdrawal',
        amount: 36561.58,
      }),
      mkTransfer({
        fromEntityId: PERSONAL_ID,
        toEntityId: INVESTMENT_ID,
        direction: 'investment_deposit',
        amount: 20000,
      }),
    ];

    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, trs, 'BRL');

    // Expenses reduced by reimbursement credits
    const expectedExpenses = 153341.78 - 33127.21;
    expect(result.totalExpenses).toBeCloseTo(expectedExpenses, 2);

    // Incoming transfers = profit_distribution + investment_withdrawal (NOT reimbursement)
    const expectedIncoming = 133971.51 + 36561.58;
    // Outgoing transfers = investment_deposit (NOT reimbursement)
    const expectedOutgoing = 20000;

    const expectedBalance = 0 - expectedExpenses - 0 + expectedIncoming - expectedOutgoing;
    expect(result.balance).toBeCloseTo(expectedBalance, 2);
    // ~30318.52, not the buggy 63445.73
    expect(result.balance).toBeCloseTo(30318.52, 0);
  });

  it('totalExpenses floors at 0 when reimbursements exceed expenses', () => {
    const txs = [
      mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'expense', amount: 100 }),
    ];
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'reimbursement',
        amount: 500,
      }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, trs, 'BRL');
    expect(result.totalExpenses).toBe(0);
  });

  it('ignores transactions belonging to other entities', () => {
    const txs = [
      mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'income', amount: 1000 }),
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'income', amount: 9999 }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, [], 'BRL');
    expect(result.totalIncome).toBe(1000);
  });

  it('ignores transfers not involving this entity', () => {
    const trs = [
      mkTransfer({
        fromEntityId: 'other-biz',
        toEntityId: 'other-personal',
        direction: 'profit_distribution',
        amount: 9999,
      }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', [], trs, 'BRL');
    expect(result.balance).toBe(0);
  });
});

// ============================================================
// calculateEntitySummary -- Business
// ============================================================

describe('calculateEntitySummary (business)', () => {
  it('income and expenses', () => {
    const txs = [
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'income', amount: 10000 }),
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'expense', amount: 3000 }),
    ];
    const result = calculateEntitySummary(BUSINESS_ID, 'business', 'Biz', txs, [], 'BRL');
    expect(result.totalIncome).toBe(10000);
    expect(result.totalExpenses).toBe(3000);
    expect(result.balance).toBe(7000);
  });

  it('reimbursement expenses from business increase totalExpenses', () => {
    const txs = [
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'expense', amount: 2000 }),
    ];
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'reimbursement',
        amount: 500,
      }),
    ];
    const result = calculateEntitySummary(BUSINESS_ID, 'business', 'Biz', txs, trs, 'BRL');
    expect(result.totalExpenses).toBe(2500);
  });

  it('reimbursement is NOT in outgoing transfers (already in expenses)', () => {
    const txs = [
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'income', amount: 10000 }),
    ];
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'reimbursement',
        amount: 1000,
      }),
    ];
    const result = calculateEntitySummary(BUSINESS_ID, 'business', 'Biz', txs, trs, 'BRL');
    // Balance = 10000 income - 1000 expenses (from reimbursement) - 0 outgoing transfers
    expect(result.balance).toBe(9000);
  });

  it('profit distributions outgoing decrease balance', () => {
    const txs = [
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'income', amount: 50000 }),
    ];
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'profit_distribution',
        amount: 20000,
      }),
    ];
    const result = calculateEntitySummary(BUSINESS_ID, 'business', 'Biz', txs, trs, 'BRL');
    expect(result.balance).toBe(50000 - 20000);
  });

  it('capital injection incoming increases balance', () => {
    const trs = [
      mkTransfer({
        fromEntityId: PERSONAL_ID,
        toEntityId: BUSINESS_ID,
        direction: 'capital_injection',
        amount: 5000,
      }),
    ];
    const result = calculateEntitySummary(BUSINESS_ID, 'business', 'Biz', [], trs, 'BRL');
    expect(result.balance).toBe(5000);
  });

  it('mixed business scenario', () => {
    const txs = [
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'income', amount: 100000 }),
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'expense', amount: 30000 }),
      mkTx({ entityId: BUSINESS_ID, entityType: 'business', type: 'investment', amount: 5000 }),
    ];
    const trs = [
      mkTransfer({ fromEntityId: BUSINESS_ID, toEntityId: PERSONAL_ID, direction: 'reimbursement', amount: 2000 }),
      mkTransfer({ fromEntityId: BUSINESS_ID, toEntityId: PERSONAL_ID, direction: 'profit_distribution', amount: 15000 }),
      mkTransfer({ fromEntityId: PERSONAL_ID, toEntityId: BUSINESS_ID, direction: 'capital_injection', amount: 3000 }),
    ];
    const result = calculateEntitySummary(BUSINESS_ID, 'business', 'Biz', txs, trs, 'BRL');

    expect(result.totalIncome).toBe(100000);
    expect(result.totalExpenses).toBe(30000 + 2000); // expense txs + reimbursement from biz
    expect(result.totalInvestments).toBe(5000);
    // balance = 100000 - 32000 - 5000 + 3000 (capital injection in) - 15000 (profit dist out)
    expect(result.balance).toBe(51000);
  });
});

// ============================================================
// calculateEntitySummary -- Multi-currency
// ============================================================

describe('calculateEntitySummary (multi-currency)', () => {
  it('converts amounts using exchangeRate', () => {
    const txs = [
      mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'income', amount: 1000, currency: 'USD', exchangeRate: 5.5 }),
      mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'expense', amount: 200, currency: 'USD', exchangeRate: 5.5 }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, [], 'BRL');
    expect(result.totalIncome).toBe(5500);
    expect(result.totalExpenses).toBe(1100);
    expect(result.balance).toBe(4400);
  });

  it('applies exchangeRate to transfers', () => {
    const trs = [
      mkTransfer({
        fromEntityId: BUSINESS_ID,
        toEntityId: PERSONAL_ID,
        direction: 'profit_distribution',
        amount: 1000,
        exchangeRate: 5.0,
      }),
    ];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', [], trs, 'BRL');
    expect(result.balance).toBe(5000);
  });
});

// ============================================================
// calculateEntitySummary -- Edge cases
// ============================================================

describe('calculateEntitySummary (edge cases)', () => {
  it('empty transactions and transfers', () => {
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', [], [], 'BRL');
    expect(result.balance).toBe(0);
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalInvestments).toBe(0);
  });

  it('sets netWorth equal to balance', () => {
    const txs = [mkTx({ entityId: PERSONAL_ID, entityType: 'personal', type: 'income', amount: 1000 })];
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'Personal', txs, [], 'BRL');
    expect(result.netWorth).toBe(result.balance);
  });

  it('populates metadata fields', () => {
    const result = calculateEntitySummary(PERSONAL_ID, 'personal', 'My Account', [], [], 'USD');
    expect(result.entityId).toBe(PERSONAL_ID);
    expect(result.entityType).toBe('personal');
    expect(result.entityName).toBe('My Account');
    expect(result.currency).toBe('USD');
  });
});

// ============================================================
// calculateTotalCapital
// ============================================================

describe('calculateTotalCapital', () => {
  it('sums netWorth across summaries', () => {
    const summaries: EntitySummary[] = [
      { entityId: '1', entityType: 'personal', entityName: 'P', totalIncome: 0, totalExpenses: 0, totalInvestments: 0, balance: 5000, netWorth: 5000, currency: 'BRL' },
      { entityId: '2', entityType: 'business', entityName: 'B', totalIncome: 0, totalExpenses: 0, totalInvestments: 0, balance: 3000, netWorth: 3000, currency: 'BRL' },
    ];
    expect(calculateTotalCapital(summaries)).toBe(8000);
  });

  it('returns 0 for empty array', () => {
    expect(calculateTotalCapital([])).toBe(0);
  });
});

// ============================================================
// calculateMonthlyTotals
// ============================================================

describe('calculateMonthlyTotals', () => {
  it('groups by month for the given year', () => {
    const txs = [
      mkTx({ type: 'income', amount: 100, date: new Date('2026-01-10') }),
      mkTx({ type: 'income', amount: 200, date: new Date('2026-01-20') }),
      mkTx({ type: 'income', amount: 500, date: new Date('2026-03-05') }),
    ];
    const result = calculateMonthlyTotals(txs, 'income', 2026);
    expect(result[0]).toBe(300); // Jan
    expect(result[1]).toBe(0);   // Feb
    expect(result[2]).toBe(500); // Mar
    expect(result.length).toBe(12);
  });

  it('ignores transactions from other years', () => {
    const txs = [
      mkTx({ type: 'income', amount: 100, date: new Date(2025, 5, 15) }),
      mkTx({ type: 'income', amount: 200, date: new Date(2026, 5, 15) }),
    ];
    const result = calculateMonthlyTotals(txs, 'income', 2026);
    expect(result[5]).toBe(200);
  });
});

// ============================================================
// calculateCategoryBreakdown
// ============================================================

describe('calculateCategoryBreakdown', () => {
  const txs = [
    mkTx({ type: 'expense', category: 'Food', amount: 300 }),
    mkTx({ type: 'expense', category: 'Food', amount: 200 }),
    mkTx({ type: 'expense', category: 'Transport', amount: 150 }),
    mkTx({ type: 'income', category: 'Salary', amount: 5000 }),
  ];

  it('groups by category with type filter', () => {
    const result = calculateCategoryBreakdown(txs, 'expense');
    expect(result['Food']).toBe(500);
    expect(result['Transport']).toBe(150);
    expect(result['Salary']).toBeUndefined();
  });

  it('groups all types without filter', () => {
    const result = calculateCategoryBreakdown(txs);
    expect(result['Salary']).toBe(5000);
    expect(result['Food']).toBe(500);
  });

  it('uses Uncategorized for empty category', () => {
    const result = calculateCategoryBreakdown([mkTx({ category: '' })]);
    expect(result['Uncategorized']).toBe(100);
  });
});

// ============================================================
// calculateGrowthRate
// ============================================================

describe('calculateGrowthRate', () => {
  it('calculates percentage change', () => {
    expect(calculateGrowthRate(150, 100)).toBe(50);
  });

  it('returns 100 when previous is 0 and current is positive', () => {
    expect(calculateGrowthRate(500, 0)).toBe(100);
  });

  it('returns 0 when both are 0', () => {
    expect(calculateGrowthRate(0, 0)).toBe(0);
  });

  it('handles negative to positive', () => {
    expect(calculateGrowthRate(100, -50)).toBe(300);
  });
});

// ============================================================
// calculateYearlyTotals -- Reports page logic
// ============================================================

describe('calculateYearlyTotals', () => {
  const incomeTxs = [mkTx({ type: 'income', amount: 10000 })];
  const expenseTxs = [mkTx({ type: 'expense', amount: 3000 })];
  const investmentTxs = [mkTx({ type: 'investment', amount: 1000 })];
  const investmentCatTxs = [mkTx({ type: 'expense', category: 'Investment', amount: 2000 })];
  const yearTransactions = [...incomeTxs, ...expenseTxs, ...investmentTxs, ...investmentCatTxs];

  const reimbursements = [
    mkTransfer({ fromEntityId: BUSINESS_ID, direction: 'reimbursement', amount: 500 }),
  ];
  const reimbursementCredits = [
    mkTransfer({ toEntityId: PERSONAL_ID, direction: 'reimbursement', amount: 500 }),
  ];
  const profitDists = [
    mkTransfer({
      fromEntityId: BUSINESS_ID,
      toEntityId: PERSONAL_ID,
      direction: 'profit_distribution',
      amount: 4000,
    }),
  ];
  const investmentTransfers = [
    mkTransfer({ fromEntityId: PERSONAL_ID, direction: 'investment_deposit', amount: 800 }),
    mkTransfer({ toEntityId: PERSONAL_ID, direction: 'investment_withdrawal', amount: 300 }),
  ];

  describe('combined view', () => {
    it('income = raw income, expenses exclude investment category', () => {
      const result = calculateYearlyTotals(
        yearTransactions, reimbursements, reimbursementCredits,
        investmentTransfers, profitDists, 'combined'
      );
      expect(result.income).toBe(10000);
      expect(result.expense).toBe(3000 + 2000 - 2000); // raw - investmentCatExp = 3000
      expect(result.balance).toBe(10000 - 3000);
    });
  });

  describe('business view', () => {
    it('expenses include reimbursements and profit distributions', () => {
      const result = calculateYearlyTotals(
        yearTransactions, reimbursements, reimbursementCredits,
        investmentTransfers, profitDists, 'business'
      );
      expect(result.income).toBe(10000);
      // raw expenses - investmentCatExp + reimbursementExp + profitDistExp
      expect(result.expense).toBe(3000 + 2000 - 2000 + 500 + 4000);
      expect(result.balance).toBe(10000 - (3000 + 500 + 4000));
    });
  });

  describe('personal view', () => {
    it('income includes reimbursement credits and profit distributions', () => {
      const result = calculateYearlyTotals(
        yearTransactions, reimbursements, reimbursementCredits,
        investmentTransfers, profitDists, 'personal'
      );
      expect(result.income).toBe(10000 + 500 + 4000);
      expect(result.expense).toBe(3000); // raw - investmentCatExp
      expect(result.balance).toBe(14500 - 3000);
    });
  });

  describe('investment total', () => {
    it('investment = max(0, investmentTxs + investmentCatExp + deposits - withdrawals)', () => {
      const result = calculateYearlyTotals(
        yearTransactions, reimbursements, reimbursementCredits,
        investmentTransfers, profitDists, 'combined'
      );
      // 1000 + 2000 + 800 - 300 = 3500
      expect(result.investment).toBe(3500);
    });

    it('investment cannot go negative', () => {
      const bigWithdrawals = [
        mkTransfer({ toEntityId: PERSONAL_ID, direction: 'investment_withdrawal', amount: 99999 }),
      ];
      const result = calculateYearlyTotals(
        [mkTx({ type: 'investment', amount: 100 })],
        [], [], bigWithdrawals, [], 'combined'
      );
      expect(result.investment).toBe(0);
    });
  });
});
