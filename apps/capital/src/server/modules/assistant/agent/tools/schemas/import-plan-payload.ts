import { z } from "zod";
import { createHash } from "node:crypto";

export const ImportPlanTransactionSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  type: z.enum(["income", "expense"]),
  category: z.string().optional(),
});

export const ImportPlanTransferSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement"]),
  counterpartyEntityType: z.enum(["business", "personal"]),
  counterpartyEntityId: z.string().min(1),
});

export const ImportPlanInvestmentTransferSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  direction: z.enum(["investment_deposit", "investment_withdrawal"]),
  investmentAccountId: z.string().min(1),
});

export const ImportPlanCreditCardSchema = z.object({
  bankName: z.string().min(1),
  lastFourDigits: z.string().length(4),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  currency: z.string().length(3),
});

// Carries intent, not the parsed rows - the real bill/lineitem data is
// recomputed from the CSV at commit time via processBillCsv (shared with
// the manual wizard), so replace-on-reupload, installment continuity and
// the manual-categorization-preservation logic only exist in one place.
// previewTotalAmount/previewTransactionCount are only for the plan card;
// they are not written anywhere.
export const ImportPlanBillSchema = z.object({
  fileId: z.string().min(1),
  creditCardId: z.string().optional(),
  newCreditCard: ImportPlanCreditCardSchema.optional(),
  closingDate: z.string().min(1),
  dueDate: z.string().min(1),
  previewTotalAmount: z.number(),
  previewTransactionCount: z.number().int().min(0),
});

export const ImportPlanReconciliationSchema = z.object({
  existingTransactionId: z.string().min(1),
  externalId: z.string().min(1),
  updates: z.object({
    amount: z.number().positive().optional(),
    date: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  }),
});

export const ImportPlanDuplicateDecisionSchema = z.object({
  externalId: z.string().min(1),
  resolution: z.enum(["skip_duplicate", "link_fuzzy", "import_anyway"]),
  existingTransactionId: z.string().optional(),
});

export const ImportPlanNewHoldingSchema = z.object({
  assetClass: z.enum([
    "stocks",
    "fii",
    "etf",
    "bdr",
    "fixed_income",
    "crypto",
    "savings",
    "international_stocks",
    "international_etf",
  ]),
  subType: z
    .enum([
      "cdb",
      "rdb",
      "lci",
      "lca",
      "cdi",
      "tesouro_selic",
      "tesouro_ipca",
      "tesouro_prefixado",
      "debenture",
    ])
    .optional(),
  ticker: z.string().optional(),
  name: z.string().min(1),
  currency: z.string().length(3),
});

export const ImportPlanInvestmentTransactionSchema = z.object({
  externalId: z.string().min(1),
  accountId: z.string().min(1),
  holdingId: z.string().optional(),
  newHolding: ImportPlanNewHoldingSchema.optional(),
  type: z.enum(["buy", "sell", "dividend", "yield_payment", "deposit", "withdrawal"]),
  quantity: z.number().optional(),
  pricePerUnit: z.number().optional(),
  totalAmount: z.number(),
  fees: z.number().optional(),
  date: z.string().min(1),
});

export const ImportPlanPayloadSchema = z.object({
  entityType: z.enum(["personal", "business"]),
  entityId: z.string().min(1),
  // Required when a plan is proposed by the agent (validated in
  // validate-import-plan-payload.ts); absent when the manual wizard
  // calls executeImport directly, since the wizard never persists the
  // original file as a ConversationFile.
  fileId: z.string().min(1).optional(),
  currency: z.string().length(3),
  bankName: z.string().optional(),
  fileName: z.string().optional(),
  ledgerBalance: z.number().optional(),
  transactions: z.array(ImportPlanTransactionSchema).default([]),
  transfers: z.array(ImportPlanTransferSchema).default([]),
  investmentTransfers: z.array(ImportPlanInvestmentTransferSchema).default([]),
  creditCards: z.array(ImportPlanCreditCardSchema).default([]),
  bills: z.array(ImportPlanBillSchema).default([]),
  reconciliations: z.array(ImportPlanReconciliationSchema).default([]),
  duplicateDecisions: z.array(ImportPlanDuplicateDecisionSchema).default([]),
  investmentTransactions: z.array(ImportPlanInvestmentTransactionSchema).default([]),
});

export type ImportPlanPayload = z.infer<typeof ImportPlanPayloadSchema>;

/**
 * Deterministic hash of any JSON-serializable value. Zod object schemas
 * emit keys in declaration order regardless of input order, so
 * JSON.stringify on a parsed payload is stable - this is what the UI
 * confirm endpoint echoes back to prove the user approved exactly what
 * they saw. Shared by both import plans (ImportPlanPayload) and revert
 * plans (RevertPlanPayload, in execute-revert.ts) - the hash itself
 * doesn't care about the payload's shape.
 */
export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function hashPlanPayload(payload: ImportPlanPayload): string {
  return hashJson(payload);
}

export function computePlanSummary(payload: ImportPlanPayload) {
  const income = payload.transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
  const expense = payload.transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  return {
    newTransactionCount: payload.transactions.length,
    skipDuplicateCount: payload.duplicateDecisions.filter((d) => d.resolution === "skip_duplicate").length,
    linkFuzzyCount: payload.duplicateDecisions.filter((d) => d.resolution === "link_fuzzy").length,
    reconciliationCount: payload.reconciliations.length,
    transferCount: payload.transfers.length + payload.investmentTransfers.length,
    creditCardCount: payload.creditCards.length,
    billCount: payload.bills.length,
    billTransactionPreviewCount: payload.bills.reduce((sum, b) => sum + b.previewTransactionCount, 0),
    billTotalPreviewAmount:
      Math.round(payload.bills.reduce((sum, b) => sum + b.previewTotalAmount, 0) * 100) / 100,
    investmentTransactionCount: payload.investmentTransactions.length,
    totalIncome: Math.round(income * 100) / 100,
    totalExpense: Math.round(expense * 100) / 100,
    currency: payload.currency,
    ledgerBalance: payload.ledgerBalance,
  };
}
