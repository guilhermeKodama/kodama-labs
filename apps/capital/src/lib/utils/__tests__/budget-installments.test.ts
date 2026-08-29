import { describe, it, expect } from 'vitest';
import { convertInstallmentsToTransactions, groupTransactionsByMonth } from '../budget';
import type { Installment, CreditCard, CreditCardBill, BillTransaction, Transaction } from '@/types';

// ============================================================
// Test data based on user's actual dataset
// ============================================================

const CARD: CreditCard = {
  id: 'card-1',
  entityId: 'personal-1',
  entityType: 'personal',
  bankName: 'Nubank',
  lastFourDigits: '3308',
  creditLimit: 93240,
  closingDay: 15,
  dueDay: 25,
  color: '#8B5CF6',
  currency: 'BRL',
  isActive: true,
  createdAt: new Date('2025-12-01'),
  updatedAt: new Date('2025-12-01'),
};

// The January 2026 bill (closing date Jan 15, 2026)
const JANUARY_BILL: CreditCardBill = {
  id: 'bill-jan',
  creditCardId: 'card-1',
  closingDate: new Date('2026-01-15'),
  dueDate: new Date('2026-01-25'),
  totalAmount: 48734.51,
  status: 'paid',
  categorizationStatus: 'completed',
  transactionCount: 100,
  createdAt: new Date('2026-01-15'),
  updatedAt: new Date('2026-01-15'),
};

// Simulated bill transactions (the source of installments)
// These are what appears on the January bill
function makeBillTx(id: string, billId: string, category: string, amount: number, date: string, instNum?: number, totalInst?: number): BillTransaction {
  return {
    id,
    billId,
    category,
    transactionDate: new Date(date),
    description: `Test item ${id}`,
    amount,
    installmentNumber: instNum,
    totalInstallments: totalInst,
    isAutoCategorized: true,
    createdAt: new Date('2026-01-15'),
    updatedAt: new Date('2026-01-15'),
  };
}

// Installments from the user's data (Shopping category)
// Using actual descriptions and amounts from screenshots
function makeInstallment(
  id: string,
  btId: string,
  desc: string,
  amount: number,
  startDate: string,
  paidInstallments: number,
  totalInstallments: number,
  category: string = 'Shopping'
): Installment {
  return {
    id,
    creditCardId: 'card-1',
    billTransactionId: btId,
    description: desc,
    category,
    totalAmount: amount * totalInstallments,
    totalInstallments,
    paidInstallments,
    remainingInstallments: totalInstallments - paidInstallments,
    startDate: new Date(startDate),
    installmentAmount: amount,
    isActive: paidInstallments < totalInstallments,
    creditCard: {
      id: 'card-1',
      bankName: 'Nubank',
      lastFourDigits: '3308',
      color: '#8B5CF6',
    },
    createdAt: new Date('2026-01-15'),
    updatedAt: new Date('2026-01-15'),
  };
}

// From the drill-down screenshots - these appeared in the January bill
const BILL_TRANSACTIONS: BillTransaction[] = [
  // paidInstallments=2 items (showed as "X/Y" with installmentNumber=2 on bill)
  makeBillTx('bt-1', 'bill-jan', 'Shopping', 55.50,  '2025-11-26', 2, 6),   // Mercadolivre*2produto
  makeBillTx('bt-2', 'bill-jan', 'Shopping', 182.20, '2025-11-24', 2, 9),   // Amazon Marketplace
  makeBillTx('bt-3', 'bill-jan', 'Shopping', 99.99,  '2025-11-21', 2, 4),   // Santalollashopdom
  makeBillTx('bt-4', 'bill-jan', 'Shopping', 979.56, '2025-11-21', 2, 5),   // 30080 Shopping Dom Pe
  makeBillTx('bt-5', 'bill-jan', 'Shopping', 391.62, '2025-11-17', 2, 12),  // Mercadolivre*Mercadol
  makeBillTx('bt-6', 'bill-jan', 'Shopping', 139.01, '2025-11-15', 2, 12),  // Amazonmktplc*Rafaelrod
  makeBillTx('bt-7', 'bill-jan', 'Shopping', 50.84,  '2025-11-14', 2, 9),   // Mercadolivre*Tecnical
  makeBillTx('bt-8', 'bill-jan', 'Shopping', 71.33,  '2025-11-14', 2, 12),  // Mercadolivre*Mercadol
  makeBillTx('bt-9', 'bill-jan', 'Shopping', 989.16, '2025-11-14', 2, 12),  // Ec *Mercadolivre
  makeBillTx('bt-10', 'bill-jan', 'Shopping', 44.90, '2025-11-14', 2, 12),  // Dm*Helphbomaxcom
  makeBillTx('bt-11', 'bill-jan', 'Shopping', 81.24, '2025-11-14', 2, 8),   // Centauro Ce39
  makeBillTx('bt-12', 'bill-jan', 'Shopping', 83.33, '2025-11-14', 2, 6),   // Centauro Ce39
  makeBillTx('bt-13', 'bill-jan', 'Shopping', 69.76, '2025-11-14', 2, 12),  // Mercadolivre*Franspor
  // paidInstallments=1 item
  makeBillTx('bt-14', 'bill-jan', 'Shopping', 112.83, '2026-01-08', 1, 10), // Mercadolivre*Mercadol
  // paidInstallments=3 items (these were the problematic ones before)
  makeBillTx('bt-15', 'bill-jan', 'Shopping', 74.26,  '2025-10-14', 3, 4),  // Shopee *Factimportados
  makeBillTx('bt-16', 'bill-jan', 'Shopping', 124.97, '2025-10-14', 3, 4),  // Mercadolivre*Luvinimp
  makeBillTx('bt-17', 'bill-jan', 'Shopping', 73.30,  '2025-10-14', 3, 6),  // Villa 88 Store
];

// Corresponding installments (created from the bill transactions above)
const INSTALLMENTS: Installment[] = [
  makeInstallment('inst-1',  'bt-1',  'Mercadolivre*2produto',      55.50,  '2025-11-26', 2, 6),
  makeInstallment('inst-2',  'bt-2',  'Amazon Marketplace',         182.20, '2025-11-24', 2, 9),
  makeInstallment('inst-3',  'bt-3',  'Santalollashopdom',          99.99,  '2025-11-21', 2, 4),
  makeInstallment('inst-4',  'bt-4',  '30080 Shopping Dom Pe',      979.56, '2025-11-21', 2, 5),
  makeInstallment('inst-5',  'bt-5',  'Mercadolivre*Mercadol',      391.62, '2025-11-17', 2, 12),
  makeInstallment('inst-6',  'bt-6',  'Amazonmktplc*Rafaelrod',     139.01, '2025-11-15', 2, 12),
  makeInstallment('inst-7',  'bt-7',  'Mercadolivre*Tecnical',      50.84,  '2025-11-14', 2, 9),
  makeInstallment('inst-8',  'bt-8',  'Mercadolivre*Mercadol',      71.33,  '2025-11-14', 2, 12),
  makeInstallment('inst-9',  'bt-9',  'Ec *Mercadolivre',           989.16, '2025-11-14', 2, 12),
  makeInstallment('inst-10', 'bt-10', 'Dm*Helphbomaxcom',           44.90,  '2025-11-14', 2, 12),
  makeInstallment('inst-11', 'bt-11', 'Centauro Ce39',              81.24,  '2025-11-14', 2, 8),
  makeInstallment('inst-12', 'bt-12', 'Centauro Ce39',              83.33,  '2025-11-14', 2, 6),
  makeInstallment('inst-13', 'bt-13', 'Mercadolivre*Franspor',      69.76,  '2025-11-14', 2, 12),
  makeInstallment('inst-14', 'bt-14', 'Mercadolivre*Mercadol',      112.83, '2026-01-08', 1, 10),
  // The items with paidInstallments=3 (were problematic - skipped Feb with old formula)
  makeInstallment('inst-15', 'bt-15', 'Shopee *Factimportados',     74.26,  '2025-10-14', 3, 4),
  makeInstallment('inst-16', 'bt-16', 'Mercadolivre*Luvinimp',      124.97, '2025-10-14', 3, 4),
  makeInstallment('inst-17', 'bt-17', 'Villa 88 Store',             73.30,  '2025-10-14', 3, 6),
];

// ============================================================
// Helper to group projected transactions by month
// ============================================================
function groupByMonth(transactions: ReturnType<typeof convertInstallmentsToTransactions>) {
  const byMonth: Record<string, { count: number; total: number; descriptions: string[] }> = {};
  for (const tx of transactions) {
    const d = new Date(tx.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { count: 0, total: 0, descriptions: [] };
    byMonth[key].count += 1;
    byMonth[key].total += tx.amount;
    byMonth[key].descriptions.push(tx.description);
  }
  return byMonth;
}

// ============================================================
// Tests
// ============================================================

describe('convertInstallmentsToTransactions', () => {
  it('should use bill closing date as anchor, not purchase date', () => {
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);

    // January bill closing is Jan 15, so January should be covered/skipped
    expect(byMonth['2026-01']).toBeUndefined();

    // February should have projections (1 month after bill closing)
    expect(byMonth['2026-02']).toBeDefined();
    expect(byMonth['2026-02'].count).toBeGreaterThan(0);
  });

  it('should have February total >= March total (monotonically decreasing)', () => {
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);
    const febTotal = byMonth['2026-02']?.total ?? 0;
    const marTotal = byMonth['2026-03']?.total ?? 0;
    const aprTotal = byMonth['2026-04']?.total ?? 0;

    console.log('Feb:', febTotal.toFixed(2), `(${byMonth['2026-02']?.count} items)`);
    console.log('Mar:', marTotal.toFixed(2), `(${byMonth['2026-03']?.count} items)`);
    console.log('Apr:', aprTotal.toFixed(2), `(${byMonth['2026-04']?.count} items)`);

    // Feb >= Mar >= Apr (installments only decrease over time)
    expect(febTotal).toBeGreaterThanOrEqual(marTotal);
    expect(marTotal).toBeGreaterThanOrEqual(aprTotal);
  });

  it('every item in March should also appear in February', () => {
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);
    const febDescs = new Set(byMonth['2026-02']?.descriptions ?? []);
    const marDescs = byMonth['2026-03']?.descriptions ?? [];

    // Every March item should have a corresponding Feb item (same installment, different number)
    // Since descriptions include (N/M), we compare the base description
    const getBase = (desc: string) => desc.replace(/\s*\(\d+\/\d+\)/, '');
    const febBases = new Set([...febDescs].map(getBase));
    const marBases = marDescs.map(getBase);

    for (const base of marBases) {
      expect(febBases.has(base)).toBe(true);
    }
  });

  it('problematic items (paidInstallments=3) should now project into Feb', () => {
    // These were the items that skipped Feb with the old formula:
    // Shopee *Factimportados (3/4), Mercadolivre*Luvinimp (3/4), Villa 88 Store (3/6)
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);
    const febDescs = byMonth['2026-02']?.descriptions ?? [];

    // With bill-anchor formula: addMonths(Jan 15, 1) = Feb 15 for ALL installments
    expect(febDescs.some(d => d.includes('Shopee *Factimportados'))).toBe(true);
    expect(febDescs.some(d => d.includes('Mercadolivre*Luvinimp'))).toBe(true);
    expect(febDescs.some(d => d.includes('Villa 88 Store'))).toBe(true);
  });

  it('should skip January (covered by the bill)', () => {
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);
    // January bill closing is Jan 15 → coveredMonths has "2026-1"
    expect(byMonth['2026-01']).toBeUndefined();
  });

  it('Shopee (3/4 → only 1 remaining) should appear in Feb only, not Mar', () => {
    // Shopee *Factimportados: paidInstallments=3, totalInstallments=4, remaining=1
    // Should only project to Feb (1 month after bill), NOT to March
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);
    const febDescs = byMonth['2026-02']?.descriptions ?? [];
    const marDescs = byMonth['2026-03']?.descriptions ?? [];

    expect(febDescs.some(d => d.includes('Shopee *Factimportados'))).toBe(true);
    expect(marDescs.some(d => d.includes('Shopee *Factimportados'))).toBe(false);
  });

  it('Feb count should be exactly 17 (all installments project here)', () => {
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);
    // All 17 installments should project their next payment into Feb
    expect(byMonth['2026-02']?.count).toBe(17);
  });

  it('should fallback to old formula when bill is not found', () => {
    // No bills and no bill transactions → uses old formula
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [],  // no bills
      []   // no bill transactions
    );

    // Should still produce results (using startDate-based fallback)
    expect(result.length).toBeGreaterThan(0);
  });

  it('print full monthly breakdown for debugging', () => {
    const result = convertInstallmentsToTransactions(
      INSTALLMENTS,
      [CARD],
      [JANUARY_BILL],
      BILL_TRANSACTIONS
    );

    const byMonth = groupByMonth(result);
    const months = Object.keys(byMonth).sort();
    
    console.log('\n=== Monthly Shopping Installment Projections ===');
    for (const month of months) {
      const { count, total } = byMonth[month];
      console.log(`${month}: R$${total.toFixed(2)} (${count} items)`);
    }
    console.log('');

    // Print Feb details
    const febTxs = result.filter(tx => {
      const d = new Date(tx.date);
      return d.getFullYear() === 2026 && d.getMonth() === 1;
    }).sort((a, b) => b.amount - a.amount);

    console.log('=== February 2026 Details ===');
    for (const tx of febTxs) {
      console.log(`  ${tx.description}: R$${tx.amount.toFixed(2)}`);
    }
  });
});

// ============================================================
// groupTransactionsByMonth
//
// Extracted from InstallmentsTable, which used to compute its own
// month buckets from `startDate + paidInstallments` directly on
// Installment rows - wrong, because startDate gets overwritten to the
// latest bill's date on every re-upload (see process-bill-csv.ts), so
// that offset double-counted elapsed months and grew/oscillated
// instead of decreasing. Fixed by piping convertInstallmentsToTransactions'
// (already correct, tested above) output through this instead.
// ============================================================

// Local-noon construction, same convention as parseLocalDate (see
// src/lib/utils/date.ts) - a raw `new Date('2026-02-01')` parses as UTC
// midnight, which rolls back to the previous local day/month in any
// timezone behind UTC and would make these tests fail depending on
// where they run.
function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    entityId: 'personal-1',
    entityType: 'personal',
    type: 'expense',
    amount: 100,
    currency: 'BRL',
    exchangeRate: 1,
    description: 'Test',
    category: 'Shopping',
    date: localDate(2026, 2, 1),
    createdAt: localDate(2026, 2, 1),
    updatedAt: localDate(2026, 2, 1),
    ...overrides,
  };
}

describe('groupTransactionsByMonth', () => {
  it('sums multiple transactions in the same month', () => {
    const result = groupTransactionsByMonth([
      tx({ date: localDate(2026, 2, 5), amount: 100 }),
      tx({ date: localDate(2026, 2, 20), amount: 50 }),
    ]);
    expect(result).toEqual([{ month: '2026-02', label: 'Feb 2026', amount: 150 }]);
  });

  it('sorts months chronologically regardless of input order', () => {
    const result = groupTransactionsByMonth([
      tx({ date: localDate(2026, 4, 1), amount: 10 }),
      tx({ date: localDate(2026, 2, 1), amount: 20 }),
      tx({ date: localDate(2026, 3, 1), amount: 30 }),
    ]);
    expect(result.map((r) => r.month)).toEqual(['2026-02', '2026-03', '2026-04']);
  });

  it('rounds each month total to cents', () => {
    const result = groupTransactionsByMonth([
      tx({ date: localDate(2026, 2, 1), amount: 10.003 }),
      tx({ date: localDate(2026, 2, 1), amount: 0.004 }),
    ]);
    expect(result[0]!.amount).toBe(10.01);
  });

  it('returns an empty array for no transactions', () => {
    expect(groupTransactionsByMonth([])).toEqual([]);
  });

  it('combined with convertInstallmentsToTransactions, still decreases month over month (the regression this whole suite exists for)', () => {
    const grouped = groupTransactionsByMonth(
      convertInstallmentsToTransactions(INSTALLMENTS, [CARD], [JANUARY_BILL], BILL_TRANSACTIONS)
    );

    const byMonth = new Map(grouped.map((g) => [g.month, g.amount]));
    const feb = byMonth.get('2026-02') ?? 0;
    const mar = byMonth.get('2026-03') ?? 0;
    const apr = byMonth.get('2026-04') ?? 0;

    expect(feb).toBeGreaterThanOrEqual(mar);
    expect(mar).toBeGreaterThanOrEqual(apr);
  });
});
