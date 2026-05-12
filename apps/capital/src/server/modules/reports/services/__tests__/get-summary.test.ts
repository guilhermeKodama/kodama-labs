import { describe, it, expect, vi } from 'vitest';
import { getSummary } from '../get-summary';
import type { DbClient } from '@capital/server/lib/prisma';

// ============================================================
// Mock DB helpers
// ============================================================

function mockDb(overrides: {
  businesses?: Array<{ id: string; name: string; defaultCurrency: string; initialBalance?: number }>;
  personalAccount?: { id: string; defaultCurrency: string; initialBalance?: number } | null;
  transactions?: Array<{ type: string; amount: number }>;
  transfers?: Array<{ amount: number }>;
  personalTransactions?: Array<{ type: string; amount: number }>;
  personalTransfers?: Array<{ amount: number }>;
}): DbClient {
  const businesses = (overrides.businesses ?? []).map((b) => ({
    ...b,
    initialBalance: b.initialBalance ?? 0,
  }));
  const personalAccount = overrides.personalAccount
    ? { ...overrides.personalAccount, initialBalance: overrides.personalAccount.initialBalance ?? 0 }
    : null;

  let txCallCount = 0;
  let trCallCount = 0;

  return {
    business: {
      findMany: vi.fn().mockResolvedValue(businesses),
    },
    personalAccount: {
      findFirst: vi.fn().mockResolvedValue(personalAccount),
    },
    transaction: {
      findMany: vi.fn().mockImplementation(() => {
        txCallCount++;
        if (txCallCount <= businesses.length) {
          return Promise.resolve(overrides.transactions ?? []);
        }
        return Promise.resolve(overrides.personalTransactions ?? overrides.transactions ?? []);
      }),
    },
    transfer: {
      findMany: vi.fn().mockImplementation(() => {
        trCallCount++;
        if (trCallCount <= businesses.length) {
          return Promise.resolve(overrides.transfers ?? []);
        }
        return Promise.resolve(overrides.personalTransfers ?? overrides.transfers ?? []);
      }),
    },
  } as unknown as DbClient;
}

// ============================================================
// Business summary
// ============================================================

describe('getSummary - business', () => {
  it('calculates income, expenses, and balance', async () => {
    const db = mockDb({
      businesses: [{ id: 'biz-1', name: 'Acme', defaultCurrency: 'BRL' }],
      transactions: [
        { type: 'income', amount: 50000 },
        { type: 'expense', amount: 15000 },
        { type: 'expense', amount: 5000 },
        { type: 'investment', amount: 3000 },
      ],
      transfers: [],
    });

    const result = await getSummary({ userId: 'user-1' }, db);

    expect(result).toHaveLength(1);
    expect(result[0].entityType).toBe('business');
    expect(result[0].totalIncome).toBe(50000);
    expect(result[0].totalExpenses).toBe(20000);
    expect(result[0].totalInvestments).toBe(3000);
    expect(result[0].balance).toBe(30000);
    expect(result[0].netWorth).toBe(33000);
  });

  it('includes reimbursement transfers as expenses', async () => {
    const db = mockDb({
      businesses: [{ id: 'biz-1', name: 'Acme', defaultCurrency: 'BRL' }],
      transactions: [
        { type: 'income', amount: 10000 },
        { type: 'expense', amount: 3000 },
      ],
      transfers: [{ amount: 1000 }, { amount: 500 }],
    });

    const result = await getSummary({ userId: 'user-1' }, db);

    expect(result[0].totalExpenses).toBe(3000 + 1000 + 500);
    expect(result[0].balance).toBe(10000 - 4500);
  });

  it('uses raw amount (no exchangeRate multiplication)', async () => {
    const db = mockDb({
      businesses: [{ id: 'biz-1', name: 'Acme', defaultCurrency: 'BRL' }],
      transactions: [{ type: 'income', amount: 1234.56 }],
      transfers: [],
    });

    const result = await getSummary({ userId: 'user-1' }, db);
    expect(result[0].totalIncome).toBe(1234.56);
  });
});

// ============================================================
// Personal summary
// ============================================================

describe('getSummary - personal', () => {
  it('calculates income, expenses, and balance', async () => {
    const db = mockDb({
      personalAccount: { id: 'pa-1', defaultCurrency: 'BRL' },
      personalTransactions: [
        { type: 'income', amount: 5000 },
        { type: 'expense', amount: 8000 },
        { type: 'investment', amount: 1000 },
      ],
      personalTransfers: [],
    });

    const result = await getSummary({ userId: 'user-1' }, db);

    expect(result).toHaveLength(1);
    expect(result[0].entityType).toBe('personal');
    expect(result[0].totalIncome).toBe(5000);
    expect(result[0].totalExpenses).toBe(8000);
    expect(result[0].totalInvestments).toBe(1000);
    expect(result[0].balance).toBe(-3000);
    expect(result[0].netWorth).toBe(-2000);
  });

  it('reduces expenses by reimbursement credits', async () => {
    const db = mockDb({
      personalAccount: { id: 'pa-1', defaultCurrency: 'BRL' },
      personalTransactions: [{ type: 'expense', amount: 2000 }],
      personalTransfers: [{ amount: 800 }],
    });

    const result = await getSummary({ userId: 'user-1' }, db);

    expect(result[0].totalExpenses).toBe(1200);
    expect(result[0].balance).toBe(-1200);
  });

  it('floors totalExpenses at 0 when credits exceed expenses', async () => {
    const db = mockDb({
      personalAccount: { id: 'pa-1', defaultCurrency: 'BRL' },
      personalTransactions: [{ type: 'expense', amount: 100 }],
      personalTransfers: [{ amount: 500 }],
    });

    const result = await getSummary({ userId: 'user-1' }, db);

    expect(result[0].totalExpenses).toBe(0);
    expect(result[0].balance).toBe(0);
  });
});

// ============================================================
// Multiple entities
// ============================================================

describe('getSummary - multiple entities', () => {
  it('returns one summary per entity', async () => {
    const db = mockDb({
      businesses: [
        { id: 'biz-1', name: 'Acme', defaultCurrency: 'BRL' },
        { id: 'biz-2', name: 'Beta', defaultCurrency: 'USD' },
      ],
      personalAccount: { id: 'pa-1', defaultCurrency: 'BRL' },
      transactions: [],
      transfers: [],
      personalTransactions: [],
      personalTransfers: [],
    });

    const result = await getSummary({ userId: 'user-1' }, db);

    expect(result).toHaveLength(3);
    expect(result.map((s) => s.entityType)).toEqual(['business', 'business', 'personal']);
  });
});

// ============================================================
// Date filtering
// ============================================================

describe('getSummary - date filtering', () => {
  it('passes dateFrom and dateTo to Prisma queries', async () => {
    const db = mockDb({
      businesses: [{ id: 'biz-1', name: 'Acme', defaultCurrency: 'BRL' }],
      personalAccount: { id: 'pa-1', defaultCurrency: 'BRL' },
      transactions: [],
      transfers: [],
      personalTransactions: [],
      personalTransfers: [],
    });

    const dateFrom = new Date('2026-01-01');
    const dateTo = new Date('2026-03-31');

    await getSummary({ userId: 'user-1', dateFrom, dateTo }, db);

    const txCalls = vi.mocked(db.transaction.findMany).mock.calls;
    expect(txCalls[0][0]!.where!.date).toEqual({ gte: dateFrom, lte: dateTo });

    const trCalls = vi.mocked(db.transfer.findMany).mock.calls;
    expect(trCalls[0][0]!.where!.date).toEqual({ gte: dateFrom, lte: dateTo });
  });
});

// ============================================================
// Edge cases
// ============================================================

describe('getSummary - edge cases', () => {
  it('returns empty array when no entities exist', async () => {
    const db = mockDb({});
    const result = await getSummary({ userId: 'user-1' }, db);
    expect(result).toEqual([]);
  });
});
