import { z } from "zod";
import { accountTypeSchema, ledgerKindSchema, transferDirectionSchema } from "./common";

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

const aggValues = z.record(z.string(), z.number().nullable());

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
