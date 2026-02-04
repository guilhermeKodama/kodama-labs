import { z } from 'zod';
import { transactionTypeSchema } from './transaction';

export const createCategorySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  type: transactionTypeSchema,
  color: z.string().optional(),
});

export type CreateCategoryFormData = z.infer<typeof createCategorySchema>;
