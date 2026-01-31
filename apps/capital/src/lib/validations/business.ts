import { z } from 'zod';

export const createBusinessSchema = z.object({
  name: z
    .string()
    .min(1, 'Business name is required')
    .max(100, 'Business name must be less than 100 characters'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  defaultCurrency: z
    .string()
    .length(3, 'Currency code must be 3 characters'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format')
    .optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial();

export type CreateBusinessFormData = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessFormData = z.infer<typeof updateBusinessSchema>;
