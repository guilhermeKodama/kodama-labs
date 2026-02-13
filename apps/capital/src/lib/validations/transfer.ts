import { z } from 'zod';

export const transferDirectionSchema = z.enum([
  'profit_distribution',
  'capital_injection',
  'reimbursement',
  'investment_deposit',
  'investment_withdrawal',
]);

export const createTransferSchema = z.object({
  fromEntityId: z.string().optional().default(''),
  fromEntityType: z.enum(['business', 'personal']),
  toEntityId: z.string().optional().default(''),
  toEntityType: z.enum(['business', 'personal']),
  direction: transferDirectionSchema,
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .max(999999999, 'Amount is too large'),
  currency: z.string().length(3, 'Currency code must be 3 characters'),
  exchangeRate: z.number().positive().optional().default(1),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  date: z.coerce.date(),
  toInvestmentAccountId: z.string().optional(),
  fromInvestmentAccountId: z.string().optional(),
});

export type CreateTransferFormData = z.infer<typeof createTransferSchema>;
