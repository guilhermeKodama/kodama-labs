import { z } from 'zod';
import { transactionTypeSchema } from './transaction';
import { remindersConfigSchema } from './reminders';

export const recurrenceFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

export const createRecurringTransactionSchema = z.object({
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
  frequency: recurrenceFrequencySchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable().transform((val) => val ?? undefined),
  autoGenerateTransaction: z.boolean().default(true),
  // Only meaningful when autoGenerateTransaction is false. Kept (not cleared)
  // when switching back to automatic mode — see recurring-form.tsx.
  reminders: remindersConfigSchema.optional(),
});

export const updateRecurringTransactionSchema = createRecurringTransactionSchema.partial().omit({
  entityId: true,
  entityType: true,
});

export type CreateRecurringTransactionFormData = z.infer<typeof createRecurringTransactionSchema>;
export type UpdateRecurringTransactionFormData = z.infer<typeof updateRecurringTransactionSchema>;
