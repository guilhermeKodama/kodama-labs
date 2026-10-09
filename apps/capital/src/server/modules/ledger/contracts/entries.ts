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
    /** Simple entries only: income <-> expense keeps the magnitude and flips the sign. */
    kind: z.enum(["income", "expense"]),
    /** Transfers only: both endpoints (and the direction) change in one atomic write. */
    fromAccountId: z.string(),
    toAccountId: z.string(),
    /** Transfers only. Without it, moved endpoints re-infer the direction unless it was set by hand. */
    direction: transferDirectionSchema,
    /** Transfers only: true books the legs as a reimbursement (expense legs), false back to a plain transfer. */
    reimbursement: z.boolean(),
    /**
     * Cross-currency transfers only: the inflow leg's amount in the destination
     * currency. The outflow amount stays unless `amount` is sent too (`amount`
     * is then the outflow, not a scale). The foreign rate is derived so it
     * matches. A same-currency transfer rejects it.
     */
    toAmount: z.number().positive(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Empty patch");
export type EntryPatch = z.infer<typeof entryPatchSchema>;

// ---------------------------------------------------------------------------
// Scoped delete
// ---------------------------------------------------------------------------

export const DELETE_SCOPES = ["one", "future", "all"] as const;
export type DeleteScope = (typeof DELETE_SCOPES)[number];

/**
 * one = this entry (its whole transfer); future = this occurrence or parcel
 * and the later ones, ending the recurrence or closing the plan; all = every
 * occurrence or parcel, deactivating the recurrence or the plan.
 */
export const deleteEntrySchema = z.object({
  scope: z.enum(DELETE_SCOPES).default("one"),
  /** Linked entries (an aporte that funded an operation, or an operation's cash leg): also delete the operation. Default true. */
  withLinkedOperation: z.boolean().optional(),
});
export type DeleteEntryInput = z.infer<typeof deleteEntrySchema>;
