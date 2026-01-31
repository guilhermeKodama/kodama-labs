import { z } from 'zod';

export const transactionTypeSchema = z.enum(['income', 'expense', 'investment']);

export const createTransactionSchema = z.object({
  entityId: z.string().min(1, 'Entity is required'),
  entityType: z.enum(['business', 'personal']),
  type: transactionTypeSchema,
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .max(999999999, 'Amount is too large'),
  currency: z.string().length(3, 'Currency code must be 3 characters'),
  exchangeRate: z.number().positive().optional().default(1),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(500, 'Description must be less than 500 characters'),
  category: z.string().min(1, 'Category is required'),
  date: z.coerce.date(),
});

export const updateTransactionSchema = createTransactionSchema.partial().omit({
  entityId: true,
  entityType: true,
});

export type CreateTransactionFormData = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionFormData = z.infer<typeof updateTransactionSchema>;
