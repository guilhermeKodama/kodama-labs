import { z } from "zod";
import { transferDirectionSchema } from "./common";

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const money = z.number().finite();
const isoDate = z.string().date();

const commonEntryFields = {
  description: z.string().min(1).max(500),
  notes: z.string().max(5000).nullish(),
  date: isoDate,
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
};

export const createEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["income", "expense"]),
    accountId: z.string(),
    /** Positive number; the sign comes from `kind` (expense = outflow). Negative expense = refund. */
    amount: money,
    categoryId: z.string().nullish(),
    isTaxDeductible: z.boolean().optional(),
    installments: z.number().int().min(2).max(72).optional(),
    externalId: z.string().max(200).optional(),
    ...commonEntryFields,
  }),
  z.object({
    kind: z.literal("transfer"),
    fromAccountId: z.string(),
    toAccountId: z.string(),
    amount: money.positive(),
    /** Amount credited when the accounts use different currencies. Defaults to amount * exchangeRate. */
    toAmount: money.positive().optional(),
    direction: transferDirectionSchema.optional(),
    ...commonEntryFields,
    description: z.string().min(1).max(500).optional(),
  }),
]);
export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const entryPatchSchema = z
  .object({
    description: z.string().min(1).max(500),
    notes: z.string().max(5000).nullable(),
    date: isoDate,
    amount: money,
    currency: z.string().length(3),
    exchangeRate: z.number().positive(),
    categoryId: z.string().nullable(),
    accountId: z.string(),
    entityId: z.string(),
    isTaxDeductible: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Empty patch");
export type EntryPatch = z.infer<typeof entryPatchSchema>;
