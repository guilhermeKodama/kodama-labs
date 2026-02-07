import { z } from 'zod';

// ============================================
// Investment Account
// ============================================

export const createInvestmentAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  broker: z.string().max(50).optional(),
  entityId: z.string().min(1, 'Entity is required'),
  entityType: z.enum(['business', 'personal']),
  currency: z.string().length(3, 'Currency code must be 3 characters'),
});

export type CreateInvestmentAccountFormData = z.infer<typeof createInvestmentAccountSchema>;

// ============================================
// Investment Holding
// ============================================

export const assetClassSchema = z.enum([
  'stocks', 'fii', 'etf', 'bdr', 'fixed_income', 'crypto',
  'savings', 'international_stocks', 'international_etf',
]);

export const fixedIncomeSubTypeSchema = z.enum([
  'cdb', 'rdb', 'lci', 'lca', 'cdi', 'tesouro_selic',
  'tesouro_ipca', 'tesouro_prefixado', 'debenture',
]);

export const createInvestmentHoldingSchema = z.object({
  accountId: z.string().min(1, 'Account is required'),
  assetClass: assetClassSchema,
  subType: fixedIncomeSubTypeSchema.optional(),
  ticker: z.string().max(20).optional(),
  name: z.string().min(1, 'Name is required').max(200),
  currency: z.string().length(3, 'Currency code must be 3 characters'),
  // Optional initial position fields
  initialAmount: z.number().positive().optional(),
  initialQuantity: z.number().positive().optional(),
  initialPricePerUnit: z.number().positive().optional(),
  initialDate: z.coerce.date().optional(),
});

export type CreateInvestmentHoldingFormData = z.infer<typeof createInvestmentHoldingSchema>;

// ============================================
// Investment Transaction
// ============================================

export const investmentTransactionTypeSchema = z.enum([
  'buy', 'sell', 'dividend', 'yield_payment', 'split', 'deposit', 'withdrawal',
]);

export const createInvestmentTransactionSchema = z.object({
  holdingId: z.string().min(1, 'Holding is required'),
  type: investmentTransactionTypeSchema,
  quantity: z.number().positive().optional(),
  pricePerUnit: z.number().positive().optional(),
  totalAmount: z.number().positive('Amount must be greater than 0'),
  fees: z.number().min(0).optional().default(0),
  date: z.coerce.date(),
  notes: z.string().max(500).optional(),
});

export type CreateInvestmentTransactionFormData = z.infer<typeof createInvestmentTransactionSchema>;
