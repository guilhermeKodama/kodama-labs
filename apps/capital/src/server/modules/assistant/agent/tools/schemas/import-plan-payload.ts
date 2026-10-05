import { z } from "zod";
import { createHash } from "node:crypto";

// Fields added for the import dialog (categoryId, createRule, and below
// accountId, cardPayments, cardStatement) are optional without defaults:
// a plan stored before them parses to the same object, so its hash holds.
export const ImportPlanTransactionSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  type: z.enum(["income", "expense"]),
  category: z.string().optional(),
  /** Category by id (the dialog's picker); wins over `category`. */
  categoryId: z.string().min(1).optional(),
  /** Learn an "equals" rule from this row's description to its category. */
  createRule: z.boolean().optional(),
});

// `flow` and `direction` answer different questions and both are
// required. `flow` is which way the money moved on the statement being
// imported ("outflow" = it left this entity's account) and is a fact:
// it must equal the sign of the parsed row, which
// validate-import-plan-payload.ts checks against the file. `direction`
// is only the label for WHY it moved, and the same label sits on
// opposite flows depending on whose statement this is - so it must
// never be used to infer the sides. See services/transfer-flow.ts.
export const ImportPlanTransferSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  flow: z.enum(["outflow", "inflow"]),
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

// Carries intent, not the parsed rows - the real statement rows are
// recomputed from the file at commit time via importCardFile (shared with
// the manual upload), so re-upload dedupe and installment continuity only
// exist in one place.
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

// direction may only change within the from/to shape the transfer already
// has (business<->personal side unchanged) - switching e.g. capital_injection
// to profit_distribution would also need to swap which side is business vs
// personal, which this reconciliation does not support. Enforced in
// execute-import.ts, not here.
export const ImportPlanTransferReconciliationSchema = z.object({
  existingTransferId: z.string().min(1),
  externalId: z.string().min(1),
  updates: z.object({
    amount: z.number().positive().optional(),
    date: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    direction: z
      .enum([
        "profit_distribution",
        "capital_injection",
        "reimbursement",
        "investment_deposit",
        "investment_withdrawal",
      ])
      .optional(),
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

// A bank row that paid a card bill ("Pagamento de fatura"): booked as a
// card_payment transfer from the import's account to the card, settling the
// statement of `statementMonth` (by default the one due nearest the date).
export const ImportPlanCardPaymentSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  description: z.string().min(1).optional(),
  cardAccountId: z.string().min(1),
  statementMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

// The rows of a card bill reviewed in the dialog, booked on the statement
// of `month` of the plan's accountId (a credit card). amount follows the
// statement convention: a charge is positive, a refund negative.
export const ImportPlanCardStatementRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount: z.number().refine((n) => n !== 0, "amount must not be zero"),
  categoryId: z.string().min(1).optional(),
  createRule: z.boolean().optional(),
  installment: z.object({ number: z.number().int().min(1), total: z.number().int().min(1) }).optional(),
  /** Book it even when an identical row is already on the statement. */
  allowDuplicate: z.boolean().optional(),
});

export const ImportPlanCardStatementSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  total: z.number().optional(),
  rows: z.array(ImportPlanCardStatementRowSchema).max(2000),
  /** Turn the bank expense that paid this bill into the statement's card_payment transfer. */
  linkPayment: z.boolean().optional(),
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
  transferReconciliations: z.array(ImportPlanTransferReconciliationSchema).default([]),
  duplicateDecisions: z.array(ImportPlanDuplicateDecisionSchema).default([]),
  investmentTransactions: z.array(ImportPlanInvestmentTransactionSchema).default([]),
  /**
   * Account the statement is imported into: a checking or cash account of
   * the entity for bank rows, a credit card for `cardStatement`. Without
   * it, the entity's default checking account.
   */
  accountId: z.string().min(1).optional(),
  cardPayments: z.array(ImportPlanCardPaymentSchema).optional(),
  cardStatement: ImportPlanCardStatementSchema.optional(),
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

  // Cash impact of the transfers, so the plan card can show "R$ X saiu /
  // R$ Y entrou" - a transfer pointing the wrong way is invisible in a
  // bare count, and a count is all the user had to confirm against.
  const transferOutflow = [
    ...payload.transfers.filter((t) => t.flow === "outflow"),
    ...payload.investmentTransfers.filter((t) => t.direction === "investment_deposit"),
  ].reduce((sum, t) => sum + t.amount, 0);
  const transferInflow = [
    ...payload.transfers.filter((t) => t.flow === "inflow"),
    ...payload.investmentTransfers.filter((t) => t.direction === "investment_withdrawal"),
  ].reduce((sum, t) => sum + t.amount, 0);

  const cardRows = payload.cardStatement?.rows ?? [];
  return {
    newTransactionCount: payload.transactions.length,
    skipDuplicateCount: payload.duplicateDecisions.filter((d) => d.resolution === "skip_duplicate").length,
    linkFuzzyCount: payload.duplicateDecisions.filter((d) => d.resolution === "link_fuzzy").length,
    reconciliationCount: payload.reconciliations.length,
    transferReconciliationCount: payload.transferReconciliations.length,
    transferCount: payload.transfers.length + payload.investmentTransfers.length,
    transferOutflow: Math.round(transferOutflow * 100) / 100,
    transferInflow: Math.round(transferInflow * 100) / 100,
    creditCardCount: payload.creditCards.length,
    billCount: payload.bills.length,
    billTransactionPreviewCount: payload.bills.reduce((sum, b) => sum + b.previewTransactionCount, 0),
    billTotalPreviewAmount:
      Math.round(payload.bills.reduce((sum, b) => sum + b.previewTotalAmount, 0) * 100) / 100,
    investmentTransactionCount: payload.investmentTransactions.length,
    cardPaymentCount: payload.cardPayments?.length ?? 0,
    cardRowCount: cardRows.length,
    cardRowTotal: Math.round(cardRows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100,
    rulesToCreate: [...payload.transactions, ...cardRows].filter((r) => r.createRule && r.categoryId).length,
    totalIncome: Math.round(income * 100) / 100,
    totalExpense: Math.round(expense * 100) / 100,
    currency: payload.currency,
    ledgerBalance: payload.ledgerBalance,
  };
}
