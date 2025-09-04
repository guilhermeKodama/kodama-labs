import { z } from 'zod';

export const WallexSubmissionSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  category: z.string().min(1, 'Category is required'),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().min(1, 'Currency is required')
});

export const SyncResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  recordId: z.number().optional()
});

export type WallexSubmissionInput = z.infer<typeof WallexSubmissionSchema>;
export type SyncResponseOutput = z.infer<typeof SyncResponseSchema>;
