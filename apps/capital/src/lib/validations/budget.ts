import { z } from 'zod';

export const budgetPeriodSchema = z.enum(['monthly', 'yearly']);

export const createBudgetSchema = z.object({
  entityId: z.string().min(1, 'Entity is required'),
  entityType: z.enum(['business', 'personal']),
  category: z.string().min(1, 'Category is required'),
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .max(999999999, 'Amount is too large'),
  currency: z.string().length(3, 'Currency code must be 3 characters'),
  period: budgetPeriodSchema,
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12).optional().nullable().transform((val) => val ?? undefined),
});

export const updateBudgetSchema = createBudgetSchema.partial().omit({
  entityId: true,
  entityType: true,
});

export type CreateBudgetFormData = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetFormData = z.infer<typeof updateBudgetSchema>;
