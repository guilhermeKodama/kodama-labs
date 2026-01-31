import { z } from 'zod';

export const transferDirectionSchema = z.enum([
  'profit_distribution',
  'capital_injection',
]);

export const createTransferSchema = z.object({
  fromEntityId: z.string().min(1, 'Source entity is required'),
  fromEntityType: z.enum(['business', 'personal']),
  toEntityId: z.string().min(1, 'Destination entity is required'),
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
});

export type CreateTransferFormData = z.infer<typeof createTransferSchema>;
