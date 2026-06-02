import { describe, it, expect } from 'vitest';
import type { Transaction, Transfer, Business, PersonalAccount } from '@/types';
import { buildCashflowSankey } from '../cashflow-sankey';

const PERSONAL_ID = 'personal-1';
const BUSINESS_A_ID = 'business-a';
const BUSINESS_B_ID = 'business-b';

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
    fromEntityId: BUSINESS_A_ID,
    fromEntityType: 'business',
    toEntityId: PERSONAL_ID,
    toEntityType: 'personal',
    direction: 'profit_distribution',
    amount: 1000,
    currency: 'BRL',
    exchangeRate: 1,
    date: new Date('2026-01-15'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const businesses: Business[] = [
  {
    id: BUSINESS_A_ID,
    userId: 'u',
    name: 'Curebase',
    defaultCurrency: 'BRL',
    color: '#06b6d4',
    initialBalance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: BUSINESS_B_ID,
    userId: 'u',
    name: 'Side Business',
    defaultCurrency: 'BRL',
    color: '#22c55e',
    initialBalance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const personalAccount: PersonalAccount = {
  id: PERSONAL_ID,
  userId: 'u',
  defaultCurrency: 'BRL',
  initialBalance: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Helper: get link value between two node ids
function linkValue(
  result: ReturnType<typeof buildCashflowSankey>,
  fromId: string,
  toId: string
): number {
  const fromIdx = result.nodes.findIndex((n) => n.id === fromId);
  const toIdx = result.nodes.findIndex((n) => n.id === toId);
  if (fromIdx < 0 || toIdx < 0) return 0;
  return result.links
    .filter((l) => l.source === fromIdx && l.target === toIdx)
    .reduce((sum, l) => sum + l.value, 0);
}

describe('buildCashflowSankey', () => {
  describe('empty', () => {
    it('returns empty nodes/links when there is no data', () => {
      const r = buildCashflowSankey([], [], businesses, personalAccount);
      expect(r.nodes).toEqual([]);
      expect(r.links).toEqual([]);
      expect(r.totals).toEqual({ income: 0, expenses: 0, investments: 0, surplus: 0, reserves: 0, priorBalance: 0 });
    });
  });

  describe('income flow', () => {
    it('routes business income through category → business → surplus', () => {
      const txs = [
        mkTx({
          entityId: BUSINESS_A_ID,
          entityType: 'business',
          type: 'income',
          category: 'Curebase',
          amount: 10000,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);

      expect(linkValue(r, 'income::Curebase', `business::${BUSINESS_A_ID}`)).toBe(10000);
      // No expenses or transfers → entire amount is surplus
      expect(linkValue(r, `business::${BUSINESS_A_ID}`, `output::surplus::business::${BUSINESS_A_ID}`)).toBe(10000);
      expect(r.totals.income).toBe(10000);
      expect(r.totals.surplus).toBe(10000);
    });

    it('routes personal income directly to the personal node', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          entityType: 'personal',
          type: 'income',
          category: 'Salary',
          amount: 5000,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);
      expect(linkValue(r, 'income::Salary', 'personal')).toBe(5000);
      expect(r.totals.income).toBe(5000);
    });
  });

  describe('profit distribution PJ → PF', () => {
    it('creates a business → personal link with the transferred amount', () => {
      const txs = [
        mkTx({
          entityId: BUSINESS_A_ID,
          entityType: 'business',
          type: 'income',
          category: 'Curebase',
          amount: 38000,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: BUSINESS_A_ID,
          toEntityId: PERSONAL_ID,
          direction: 'profit_distribution',
          amount: 18000,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount);

      expect(linkValue(r, `business::${BUSINESS_A_ID}`, 'personal')).toBe(18000);
      // Business surplus = 38000 - 18000 transferred = 20000
      expect(linkValue(r, `business::${BUSINESS_A_ID}`, `output::surplus::business::${BUSINESS_A_ID}`)).toBe(20000);
      // Personal received 18000, none spent → 18000 surplus
      expect(linkValue(r, 'personal', 'output::surplus::personal')).toBe(18000);
    });
  });

  describe('expense categorization', () => {
    it('routes personal expenses through their categories', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 10000,
        }),
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Rent',
          amount: 3000,
        }),
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Food',
          amount: 800,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);

      expect(linkValue(r, 'personal', 'expense::Rent')).toBe(3000);
      expect(linkValue(r, 'personal', 'expense::Food')).toBe(800);
      expect(r.totals.expenses).toBe(3800);
      // Surplus = 10000 - 3800 = 6200
      expect(linkValue(r, 'personal', 'output::surplus::personal')).toBe(6200);
    });
  });

  describe('investments', () => {
    it('aggregates investment-type transactions into the Investments node', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 10000,
        }),
        mkTx({
          entityId: PERSONAL_ID,
          type: 'investment',
          category: 'Stocks',
          amount: 2000,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);
      expect(linkValue(r, 'personal', 'output::investments')).toBe(2000);
      expect(r.totals.investments).toBe(2000);
    });

    it('treats expense category "Investment" as investment contribution', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 10000,
        }),
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Investment',
          amount: 1500,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);
      // Should NOT create an expense::Investment node
      expect(r.nodes.find((n) => n.id === 'expense::Investment')).toBeUndefined();
      expect(linkValue(r, 'personal', 'output::investments')).toBe(1500);
      expect(r.totals.investments).toBe(1500);
      expect(r.totals.expenses).toBe(0);
    });

    it('aggregates investment_deposit transfers', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 10000,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: PERSONAL_ID,
          fromEntityType: 'personal',
          toEntityId: PERSONAL_ID,
          direction: 'investment_deposit',
          amount: 2500,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount);
      expect(linkValue(r, 'personal', 'output::investments')).toBe(2500);
    });
  });

  describe('Others grouping (< 2% threshold)', () => {
    it('groups expense categories under the threshold into a single "Others" node', () => {
      // Big expense: 9000 (≥ 2% of 10000)
      // Small ones: each 100 (< 2%)
      const txs: Transaction[] = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 50000,
        }),
        mkTx({ entityId: PERSONAL_ID, type: 'expense', category: 'Rent', amount: 9000 }),
        mkTx({ entityId: PERSONAL_ID, type: 'expense', category: 'Coffee', amount: 50 }),
        mkTx({ entityId: PERSONAL_ID, type: 'expense', category: 'Snacks', amount: 30 }),
        mkTx({ entityId: PERSONAL_ID, type: 'expense', category: 'Streaming', amount: 20 }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);

      // Rent stays as its own node
      expect(linkValue(r, 'personal', 'expense::Rent')).toBe(9000);
      // Small ones are grouped
      const othersValue = linkValue(r, 'personal', 'expense::__others__');
      expect(othersValue).toBe(100);

      const othersNode = r.nodes.find((n) => n.id === 'expense::__others__');
      expect(othersNode?.kind).toBe('others');
      expect(othersNode?.subItems?.map((s) => s.name).sort()).toEqual([
        'Coffee',
        'Snacks',
        'Streaming',
      ]);
    });

    it('groups under a custom threshold', () => {
      const txs: Transaction[] = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 1000,
        }),
        mkTx({ entityId: PERSONAL_ID, type: 'expense', category: 'A', amount: 500 }),
        mkTx({ entityId: PERSONAL_ID, type: 'expense', category: 'B', amount: 50 }),
      ];
      // With threshold 0.5, B (50/550 ≈ 9%) is below 50% → grouped
      const r = buildCashflowSankey(txs, [], businesses, personalAccount, {
        groupThreshold: 0.5,
      });
      expect(linkValue(r, 'personal', 'expense::__others__')).toBe(50);
      expect(r.nodes.find((n) => n.id === 'expense::B')).toBeUndefined();
    });
  });

  describe('date range filter', () => {
    it('excludes transactions outside the range', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 1000,
          date: new Date('2026-01-15'),
        }),
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 2000,
          date: new Date('2026-03-15'),
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount, {
        dateFrom: new Date('2026-02-01'),
        dateTo: new Date('2026-03-31'),
      });
      expect(r.totals.income).toBe(2000);
    });
  });

  describe('entity filter', () => {
    it('only includes transactions touching the filtered entities', () => {
      const txs = [
        mkTx({
          entityId: BUSINESS_A_ID,
          entityType: 'business',
          type: 'income',
          category: 'Client A',
          amount: 5000,
        }),
        mkTx({
          entityId: BUSINESS_B_ID,
          entityType: 'business',
          type: 'income',
          category: 'Client B',
          amount: 3000,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount, {
        filteredEntityIds: new Set([BUSINESS_A_ID]),
      });
      expect(r.totals.income).toBe(5000);
      expect(r.nodes.find((n) => n.id === `business::${BUSINESS_B_ID}`)).toBeUndefined();
    });
  });

  describe('multi-currency', () => {
    it('normalizes via amount * exchangeRate', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 100,
          currency: 'USD',
          exchangeRate: 5,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);
      expect(r.totals.income).toBe(500);
    });
  });

  describe('deficit (spending > income)', () => {
    it('balances the diagram via a virtual "Prior Balance" source node', () => {
      // Personal receives 1000 from Kodama but spends 1500 → 500 deficit
      const txs = [
        mkTx({
          entityId: BUSINESS_A_ID,
          entityType: 'business',
          type: 'income',
          category: 'Curebase',
          amount: 1000,
        }),
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Rent',
          amount: 1500,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: BUSINESS_A_ID,
          toEntityId: PERSONAL_ID,
          direction: 'profit_distribution',
          amount: 1000,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount);

      // Prior balance covers the missing 500 (NOT "From Reserves" — no
      // investment was liquidated)
      expect(linkValue(r, 'income::__prior_balance__', 'personal')).toBe(500);
      expect(r.totals.priorBalance).toBe(500);
      expect(r.totals.reserves).toBe(0);
      expect(r.nodes.find((n) => n.id === 'income::__reserves__')).toBeUndefined();
      // Real income (excluding the virtual node) is still 1000
      expect(r.totals.income).toBe(1000);
      // The virtual node uses the prior_balance kind (neutral) not reserves (alert)
      expect(r.nodes.find((n) => n.id === 'income::__prior_balance__')?.kind).toBe('prior_balance');
    });

    it('does not create a prior balance node when income covers spending', () => {
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'income',
          category: 'Salary',
          amount: 1000,
        }),
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Rent',
          amount: 500,
        }),
      ];
      const r = buildCashflowSankey(txs, [], businesses, personalAccount);
      expect(r.nodes.find((n) => n.id === 'income::__prior_balance__')).toBeUndefined();
      expect(r.nodes.find((n) => n.id === 'income::__reserves__')).toBeUndefined();
      expect(r.totals.priorBalance).toBe(0);
      expect(r.totals.reserves).toBe(0);
    });
  });

  describe('reserves (investment_withdrawal)', () => {
    it('creates a "From Reserves" inflow when an investment is liquidated', () => {
      // Personal pulls 2000 out of an investment account and spends 1800 of it
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Medical',
          amount: 1800,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: 'some-investment-account',
          fromEntityType: 'personal',
          toEntityId: PERSONAL_ID,
          toEntityType: 'personal',
          direction: 'investment_withdrawal',
          amount: 2000,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount);

      expect(linkValue(r, 'income::__reserves__', 'personal')).toBe(2000);
      expect(r.totals.reserves).toBe(2000);
      // Withdrawal exceeded spend by 200 → that 200 stays as surplus, no deficit
      expect(linkValue(r, 'personal', 'output::surplus::personal')).toBe(200);
      expect(r.totals.priorBalance).toBe(0);
      expect(r.nodes.find((n) => n.id === 'income::__prior_balance__')).toBeUndefined();
    });

    it('shows both reserves and prior balance when withdrawal does not cover the gap', () => {
      // Personal pulls 500 from investment, spends 1500 → 500 reserves + 1000 prior balance
      const txs = [
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Rent',
          amount: 1500,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: 'some-investment-account',
          fromEntityType: 'personal',
          toEntityId: PERSONAL_ID,
          toEntityType: 'personal',
          direction: 'investment_withdrawal',
          amount: 500,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount);

      expect(linkValue(r, 'income::__reserves__', 'personal')).toBe(500);
      expect(linkValue(r, 'income::__prior_balance__', 'personal')).toBe(1000);
      expect(r.totals.reserves).toBe(500);
      expect(r.totals.priorBalance).toBe(1000);
    });
  });

  describe('profit_distribution with entity filter', () => {
    it('treats incoming profit_distribution as external income when source is filtered out', () => {
      // Kodama receives 10000, distributes 9000 to Personal. User filters to "Personal only".
      // Bug before fix: Kodama becomes a ghost node with no inflow → 9000 deficit →
      // bogus "Prior Balance" of 9000 from Personal's perspective.
      // Expected after fix: the 9000 distribution shows up as a Profit Distribution
      // income category for Personal; no Kodama node, no virtual deficit.
      const txs = [
        mkTx({
          entityId: BUSINESS_A_ID,
          entityType: 'business',
          type: 'income',
          category: 'Curebase',
          amount: 10000,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: BUSINESS_A_ID,
          toEntityId: PERSONAL_ID,
          direction: 'profit_distribution',
          amount: 9000,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount, {
        filteredEntityIds: new Set([PERSONAL_ID]),
        labels: { profitDistribution: 'Profit Distribution' },
      });

      // Kodama node not rendered
      expect(r.nodes.find((n) => n.id === `business::${BUSINESS_A_ID}`)).toBeUndefined();
      // No virtual prior_balance / reserves needed
      expect(r.nodes.find((n) => n.id === 'income::__prior_balance__')).toBeUndefined();
      expect(r.nodes.find((n) => n.id === 'income::__reserves__')).toBeUndefined();
      // Distribution flows in as an income category
      expect(linkValue(r, 'income::Profit Distribution', 'personal')).toBe(9000);
      // And remains as surplus (nothing spent)
      expect(linkValue(r, 'personal', 'output::surplus::personal')).toBe(9000);
      expect(r.totals.priorBalance).toBe(0);
    });

    it('still draws the cross-entity link when both source and destination match the filter', () => {
      const txs = [
        mkTx({
          entityId: BUSINESS_A_ID,
          entityType: 'business',
          type: 'income',
          category: 'Curebase',
          amount: 10000,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: BUSINESS_A_ID,
          toEntityId: PERSONAL_ID,
          direction: 'profit_distribution',
          amount: 6000,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount, {
        filteredEntityIds: new Set([BUSINESS_A_ID, PERSONAL_ID]),
      });

      // Both entities present, normal cross-entity link rendered
      expect(linkValue(r, `business::${BUSINESS_A_ID}`, 'personal')).toBe(6000);
      expect(r.nodes.find((n) => n.id === 'income::Profit Distribution')).toBeUndefined();
    });
  });

  describe('reimbursement', () => {
    it('does not create double-counting (skipped in v1)', () => {
      const txs = [
        mkTx({
          entityId: BUSINESS_A_ID,
          entityType: 'business',
          type: 'income',
          category: 'Curebase',
          amount: 10000,
        }),
        // Personal pays a business expense out of pocket; business reimburses
        mkTx({
          entityId: PERSONAL_ID,
          type: 'expense',
          category: 'Travel',
          amount: 500,
        }),
      ];
      const trs = [
        mkTransfer({
          fromEntityId: BUSINESS_A_ID,
          toEntityId: PERSONAL_ID,
          direction: 'reimbursement',
          amount: 500,
        }),
      ];
      const r = buildCashflowSankey(txs, trs, businesses, personalAccount);
      // Reimbursement is not added as an income on personal, so totals remain clean
      expect(r.totals.income).toBe(10000);
      // Personal had a 500 travel expense, but no income → personal node has 500 inflow
      // from... nothing! So no expense link is created (personal has no income, no inflow)
      // Actually, since personal has no inflow, the expense link is still added; just no surplus.
      expect(linkValue(r, 'personal', 'expense::Travel')).toBe(500);
    });
  });
});
