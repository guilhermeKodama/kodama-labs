import { z } from "zod";

/** Vocabulary shared by every ledger contract: kinds, fields, time buckets and periods. */

export const LEDGER_KINDS = ["income", "expense", "transfer", "investment"] as const;
export const ACCOUNT_TYPES = ["checking", "credit_card", "brokerage", "cash"] as const;
export const TRANSFER_DIRECTIONS = [
  "profit_distribution",
  "capital_injection",
  "reimbursement",
  "investment_deposit",
  "investment_withdrawal",
  "card_payment",
  "between_accounts",
] as const;

export const ledgerKindSchema = z.enum(LEDGER_KINDS);
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const transferDirectionSchema = z.enum(TRANSFER_DIRECTIONS);

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** Categorical fields: filterable with equality/set operators and groupable. */
export const CATEGORICAL_FIELDS = [
  "entityId",
  "accountId",
  "accountType",
  "categoryId",
  "kind",
  "currency",
  "isTaxDeductible",
  "isRecurring",
  "transferDirection",
  "cardStatementId",
  "importId",
] as const;

export const NUMERIC_FIELDS = ["amount", "amountBase"] as const;
export const DATE_FIELDS = ["date", "effectiveDate"] as const;
export const TEXT_FIELDS = ["description"] as const;
export const TIME_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;

export const categoricalFieldSchema = z.enum(CATEGORICAL_FIELDS);
export const numericFieldSchema = z.enum(NUMERIC_FIELDS);
export const dateFieldSchema = z.enum(DATE_FIELDS);
export const timeBucketSchema = z.enum(TIME_BUCKETS);

export type CategoricalField = z.infer<typeof categoricalFieldSchema>;
export type NumericField = z.infer<typeof numericFieldSchema>;
export type DateField = z.infer<typeof dateFieldSchema>;
export type TimeBucket = z.infer<typeof timeBucketSchema>;

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

export const PERIOD_PRESETS = ["this_month", "last_month", "last_3m", "ytd", "last_12m", "all"] as const;

export const periodSchema = z.union([
  z.object({
    preset: z.enum(PERIOD_PRESETS),
    /** Steps back (negative) or forward from the current period, in units of the preset's length. */
    offset: z.number().int().min(-240).max(0).default(0),
  }),
  z.object({
    from: z.string().date(),
    to: z.string().date(),
  }),
]);
export type Period = z.infer<typeof periodSchema>;
