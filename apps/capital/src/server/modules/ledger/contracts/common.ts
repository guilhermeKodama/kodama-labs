import { z } from "zod";
import type { FlowKind } from "../lib/flow-sql";

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

/** flowKind values (the derived "Tipo"; ../lib/flow-sql.ts defines them). */
export const FLOW_KIND_VALUES = ["in", "out", "invest", "transfer"] as const satisfies readonly FlowKind[];

export const ledgerKindSchema = z.enum(LEDGER_KINDS);
export const flowKindSchema = z.enum(FLOW_KIND_VALUES);
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const transferDirectionSchema = z.enum(TRANSFER_DIRECTIONS);

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Categorical fields: filterable with equality/set operators and groupable.
 * `flowKind` is the derived "Tipo" (in | out | invest | transfer, see
 * ../lib/flow-sql.ts); the UI filters and groups by it, never by `kind`.
 * `id`, `transferGroupId`, `recurringRuleId` and `installmentPlanId` serve
 * drills to one row, one transfer, one recurring rule or one purchase.
 */
export const CATEGORICAL_FIELDS = [
  "entityId",
  /** The entity's kind, "personal" (PF) or "business" (PJ): "PJ" means every business, also ones added later. */
  "entityKind",
  "accountId",
  "accountType",
  "categoryId",
  "kind",
  "flowKind",
  "currency",
  "isTaxDeductible",
  "isRecurring",
  "transferDirection",
  "cardStatementId",
  "importId",
  "id",
  "transferGroupId",
  "recurringRuleId",
  "installmentPlanId",
] as const;

export const NUMERIC_FIELDS = ["amount", "amountBase"] as const;
export const DATE_FIELDS = ["date", "effectiveDate"] as const;
export const TEXT_FIELDS = ["description"] as const;
/**
 * Date buckets and their keys: day YYYY-MM-DD, week YYYY-MM-DD (the ISO
 * week's Monday), monthWeek YYYY-MM-Wn (n = ceil(day / 7), the UI's
 * "Sem. 3 · set"), month YYYY-MM, quarter YYYY-Qn, year YYYY.
 */
export const TIME_BUCKETS = ["day", "week", "monthWeek", "month", "quarter", "year"] as const;

export const categoricalFieldSchema = z.enum(CATEGORICAL_FIELDS);
export const textFieldSchema = z.enum(TEXT_FIELDS);
export const numericFieldSchema = z.enum(NUMERIC_FIELDS);
export const dateFieldSchema = z.enum(DATE_FIELDS);
export const timeBucketSchema = z.enum(TIME_BUCKETS);

export type CategoricalField = z.infer<typeof categoricalFieldSchema>;
export type NumericField = z.infer<typeof numericFieldSchema>;
export type DateField = z.infer<typeof dateFieldSchema>;
export type TextField = z.infer<typeof textFieldSchema>;
export type TimeBucket = z.infer<typeof timeBucketSchema>;

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

export const PERIOD_PRESETS = ["this_month", "last_month", "last_3m", "ytd", "last_12m", "all"] as const;

export const periodSchema = z.union([
  z.object({
    preset: z.enum(PERIOD_PRESETS),
    /**
     * Steps back (negative) from the current period, in units of the
     * preset's length. "ytd" at 0 is January to the current month; a
     * negative offset is that whole calendar year.
     */
    offset: z.number().int().min(-240).max(0).default(0),
  }),
  z.object({
    from: z.string().date(),
    to: z.string().date(),
  }),
]);
export type Period = z.infer<typeof periodSchema>;
