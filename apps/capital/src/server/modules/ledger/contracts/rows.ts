import { z } from "zod";
import { accountTypeSchema, flowKindSchema, ledgerKindSchema, transferDirectionSchema } from "./common";

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const ledgerRowSchema = z.object({
  id: z.string(),
  date: z.string(),
  effectiveDate: z.string(),
  description: z.string(),
  notes: z.string().nullable(),
  kind: ledgerKindSchema,
  amount: z.number(),
  currency: z.string(),
  exchangeRate: z.number(),
  amountBase: z.number(),
  entityId: z.string(),
  accountId: z.string(),
  accountType: accountTypeSchema,
  categoryId: z.string().nullable(),
  isTaxDeductible: z.boolean(),
  isRecurring: z.boolean(),
  transferGroupId: z.string().nullable(),
  transferDirection: transferDirectionSchema.nullable(),
  counterpartAccountId: z.string().nullable(),
  cardStatementId: z.string().nullable(),
  installmentPlanId: z.string().nullable(),
  installmentNumber: z.number().nullable(),
  recurringRuleId: z.string().nullable(),
  importId: z.string().nullable(),
  deletedAt: z.string().nullable(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

/**
 * A row in display mode (semantics "display"): one per entry, one per
 * transfer. The base fields are the representative leg's (the outflow,
 * never the broker leg); `displayAmount` is what the UI shows and sums.
 */
export const ledgerDisplayRowSchema = ledgerRowSchema.extend({
  /** Ids of the legs this row stands for (both legs of a neutral transfer, the representative first). */
  legIds: z.array(z.string()),
  flowKind: flowKindSchema,
  /** false for neutral transfers and broker buy/sell cash legs: they never enter sums or KPIs. */
  counts: z.boolean(),
  /** Base currency: absolute for a neutral transfer, negative for an aporte, signed otherwise. */
  displayAmount: z.number(),
  /** A transfer with both legs selected, shown as "⇄ value", from → to. */
  neutral: z.boolean(),
  /** Entity of the transfer's other leg (the destination of a neutral transfer). */
  counterpartEntityId: z.string().nullable(),
  /** Number of parcels of the installment plan ("3/10"). */
  installmentTotal: z.number().nullable(),
  /** Investment operation this row belongs to: the operation of a cash leg, or the one an aporte funded. */
  linkedOperationId: z.string().nullable(),
  operationType: z.string().nullable(),
  attachmentCount: z.number(),
  /** The row's key for each groupBy key, when the query is grouped (same keys as `groups`). */
  groupKeys: z.array(z.string().nullable()).optional(),
});
export type LedgerDisplayRow = z.infer<typeof ledgerDisplayRowSchema>;

const aggValues = z.record(z.string(), z.number().nullable());

/** The KPI strip (Entradas, Saídas, Aportes, Resultado, Linhas) over the counted display rows. */
export const ledgerSummarySchema = z.object({
  /** Σ positive counted amounts, aportes aside. */
  income: z.number(),
  /** −Σ negative counted amounts, aportes aside (a positive number). */
  expense: z.number(),
  /** −Σ counted aporte amounts (money into investments, net of withdrawals). */
  investment: z.number(),
  /** Σ counted amounts = income − expense − investment. */
  net: z.number(),
  /** Display rows. */
  count: z.number(),
});
export type LedgerSummary = z.infer<typeof ledgerSummarySchema>;

/**
 * One group. `count` is display rows (legs in legs mode); sums are over the
 * counted rows. Grouping by entity, a neutral transfer between two
 * entities falls under the key "<fromEntityId>→<toEntityId>"; grouping by
 * account, every neutral transfer does ("<fromAccountId>→<toAccountId>").
 * Groups come sorted: time buckets ascending, others by |sum| descending.
 */
export const ledgerGroupSchema: z.ZodType<LedgerGroup> = z.lazy(() =>
  z.object({
    key: z.string().nullable(),
    count: z.number(),
    values: aggValues,
    children: z.array(ledgerGroupSchema).optional(),
  })
);
export interface LedgerGroup {
  key: string | null;
  count: number;
  values: Record<string, number | null>;
  children?: LedgerGroup[];
}

export const ledgerQueryResultSchema = z.object({
  rows: z.array(ledgerRowSchema),
  groups: z.array(ledgerGroupSchema),
  totals: z.object({ count: z.number(), values: aggValues }),
  pivot: z
    .object({
      rowKeys: z.array(z.string().nullable()),
      colKeys: z.array(z.string().nullable()),
      cells: z.array(z.array(z.number().nullable())),
      rowTotals: z.array(z.number().nullable()),
      colTotals: z.array(z.number().nullable()),
      grandTotal: z.number().nullable(),
    })
    .optional(),
  range: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  pageInfo: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});
export type LedgerQueryResult = z.infer<typeof ledgerQueryResultSchema>;

/** POST /v2/ledger/query with semantics "display". totals and summary are null with skipTotals. */
export const ledgerDisplayQueryResultSchema = ledgerQueryResultSchema.extend({
  rows: z.array(ledgerDisplayRowSchema),
  totals: z.object({ count: z.number(), values: aggValues }).nullable(),
  summary: ledgerSummarySchema.nullable(),
});
export type LedgerDisplayQueryResult = z.infer<typeof ledgerDisplayQueryResultSchema>;
