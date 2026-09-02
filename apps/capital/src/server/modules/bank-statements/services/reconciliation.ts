import type { ParsedBankTransaction } from "./parsers/types";
import { extractShortTitle } from "../utils";
import {
  flowForRowType,
  suggestDirectionForFlow,
  type TransferFlow,
  type TransferEntityType,
  type EntityTransferDirection,
  type InvestmentTransferDirection,
} from "./transfer-flow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClassificationType =
  | "regular_transaction"
  | "entity_transfer"
  | "investment_transfer"
  | "credit_card_payment";

export type Confidence = "high" | "medium" | "low";

export type TransferDirection = EntityTransferDirection;

export type InvestmentDirection = InvestmentTransferDirection;

export interface TransferDetails {
  suggestedEntityId: string;
  suggestedEntityName: string;
  suggestedEntityType: "business" | "personal";
  /**
   * Which way the money moved on this statement. Read straight off the
   * row's sign, so it is always right - unlike suggestedDirection, which
   * is only a guess at the reason and needs to know whose statement this
   * is to even be well-defined.
   */
  suggestedFlow: TransferFlow;
  suggestedDirection: TransferDirection;
}

export interface InvestmentDetails {
  direction: InvestmentDirection;
  suggestedAccountId?: string;
}

export interface CreditCardDetails {
  suggestedBankName: string;
  dueDay: number;
  closingDay: number;
}

export interface ClassificationCandidate {
  type: ClassificationType;
  confidence: Confidence;
  transferDetails?: TransferDetails;
  investmentDetails?: InvestmentDetails;
  creditCardDetails?: CreditCardDetails;
}

export interface NormalizedTransaction {
  fitId: string;
  date: Date;
  description: string;
  fullDescription: string;
  amount: number;
  type: "income" | "expense";
}

export interface ClassifiedTransaction extends NormalizedTransaction {
  candidates: ClassificationCandidate[];
  resolvedClassification?: ClassificationType;
  needsResolution: boolean;
}

export type ReconciliationStatus = "new" | "duplicate" | "changed" | "fuzzy_match";

export interface FieldDiff {
  field: "amount" | "date" | "description";
  existingValue: string;
  ofxValue: string;
}

export interface FuzzyMatchedTransaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  type: "income" | "expense";
}

export interface ReconciledTransaction extends NormalizedTransaction {
  status: ReconciliationStatus;
  existingTransactionId?: string;
  diffs?: FieldDiff[];
  fuzzyMatchedTransaction?: FuzzyMatchedTransaction;
}

export interface ExistingTransactionData {
  id: string;
  externalId: string | null;
  amount: number;
  date: Date;
  description: string;
  type: "income" | "expense";
}

export interface EntityInfo {
  id: string;
  name: string;
  entityType: "business" | "personal";
}

export interface InvestmentAccountInfo {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

const CREDIT_CARD_PAYMENT_PATTERNS = ["pagamento de fatura"];

const INVESTMENT_TRANSFER_PATTERNS: Array<{
  pattern: string;
  direction: InvestmentDirection;
}> = [
  { pattern: "aplicação rdb", direction: "investment_deposit" },
  { pattern: "resgate rdb", direction: "investment_withdrawal" },
];

// ---------------------------------------------------------------------------
// Counterparty extraction (replicates logic from post-parse.ts)
// ---------------------------------------------------------------------------

export function extractCounterparty(memo: string): string | null {
  // Pix sent via Open Banking: skip the "Iniciada por: ..." segment
  const pixOpenBank = memo.match(
    /^Transferência enviada pelo Pix via Open Banking\s*-\s*[^-]+-\s*([^-]+)/i
  );
  if (pixOpenBank) return pixOpenBank[1].trim();

  const pixSent = memo.match(
    /^Transferência enviada pelo Pix\s*-\s*([^-]+)/i
  );
  if (pixSent) return pixSent[1].trim();

  const pixReceived = memo.match(
    /^Transferência recebida pelo Pix\s*-\s*([^-]+)/i
  );
  if (pixReceived) return pixReceived[1].trim();

  const transferReceived = memo.match(
    /^Transferência Recebida\s*-\s*([^-]+)/i
  );
  if (transferReceived) return transferReceived[1].trim();

  const boleto = memo.match(
    /^Pagamento de boleto efetuado\s*-\s*([^-]+)/i
  );
  if (boleto) return boleto[1].trim();

  const ted = memo.match(/^TED\s+(?:enviada|recebida)\s*-\s*([^-]+)/i);
  if (ted) return ted[1].trim();

  return null;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-záàâãéêíóôõúüç0-9\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// normalizeTransactions: convert raw parsed transactions to normalized form
// ---------------------------------------------------------------------------

export function normalizeTransactions(
  parsed: ParsedBankTransaction[]
): NormalizedTransaction[] {
  return parsed.map((tx) => ({
    fitId: tx.fitId,
    date: tx.date,
    description: extractShortTitle(tx.memo),
    fullDescription: tx.memo,
    amount: Math.abs(tx.amount),
    type: tx.amount >= 0 ? ("income" as const) : ("expense" as const),
  }));
}

// ---------------------------------------------------------------------------
// classifyTransactions: produce ALL possible classifications per transaction
// ---------------------------------------------------------------------------

export interface ClassificationContext {
  /**
   * The entity whose statement is being imported. Without it the
   * suggested direction is only a guess: "money left this account" is
   * a capital_injection from a personal account but a
   * profit_distribution from a business one. Omit it only where the
   * entity genuinely isn't chosen yet (the manual wizard picks it after
   * parsing) - `suggestedFlow` is correct either way.
   */
  importedEntityType?: TransferEntityType;
  bankName?: string;
}

export function classifyTransactions(
  transactions: NormalizedTransaction[],
  entities: EntityInfo[],
  investmentAccounts: InvestmentAccountInfo[] = [],
  context: ClassificationContext = {}
): ClassifiedTransaction[] {
  const bankName = context.bankName ?? "";
  const entityCandidates = entities.map((e) => ({
    ...e,
    normalized: normalizeForMatch(e.name),
  }));

  return transactions.map((tx) => {
    const candidates: ClassificationCandidate[] = [];
    const lower = tx.description.toLowerCase();
    const fullLower = tx.fullDescription.toLowerCase();

    // --- Credit card payment detection ---
    const isCreditCardPayment = CREDIT_CARD_PAYMENT_PATTERNS.some((p) =>
      lower.includes(p)
    );
    if (isCreditCardPayment) {
      const dueDay = tx.date.getUTCDate();
      const closingDay = dueDay <= 10 ? dueDay + 20 : dueDay - 10;
      const cleanBankName = bankName
        .replace(/\bS\.?A\.?\b/gi, "")
        .replace(/\bS\/A\b/gi, "")
        .replace(/\bLTDA\.?\b/gi, "")
        .replace(/[.,]+\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      candidates.push({
        type: "credit_card_payment",
        confidence: "high",
        creditCardDetails: {
          suggestedBankName: cleanBankName || bankName,
          dueDay,
          closingDay,
        },
      });
    }

    // --- Investment transfer detection ---
    for (const { pattern, direction } of INVESTMENT_TRANSFER_PATTERNS) {
      if (fullLower.includes(pattern) || lower.includes(pattern)) {
        const matchingAccount = investmentAccounts.length === 1
          ? investmentAccounts[0]
          : undefined;
        candidates.push({
          type: "investment_transfer",
          confidence: "high",
          investmentDetails: {
            direction,
            suggestedAccountId: matchingAccount?.id,
          },
        });
        break;
      }
    }

    // --- Entity transfer detection ---
    const counterparty = extractCounterparty(tx.fullDescription);
    if (counterparty) {
      const normalizedCounterparty = normalizeForMatch(counterparty);

      for (const entity of entityCandidates) {
        if (entity.normalized.length < 3) continue;
        const matches =
          normalizedCounterparty.startsWith(entity.normalized) ||
          entity.normalized.startsWith(normalizedCounterparty) ||
          normalizedCounterparty.includes(entity.normalized) ||
          entity.normalized.includes(normalizedCounterparty);

        if (matches) {
          const suggestedFlow = flowForRowType(tx.type);
          // When the caller hasn't said whose statement this is, assume
          // the counterparty's opposite - which for the business-only
          // entity list means the personal account, the historical
          // assumption. The caller that knows (reconcile_statement)
          // passes it and gets the right label.
          const importedEntityType: TransferEntityType =
            context.importedEntityType ?? (entity.entityType === "business" ? "personal" : "business");
          const suggestedDirection = suggestDirectionForFlow(
            suggestedFlow,
            importedEntityType,
            entity.entityType
          );

          candidates.push({
            type: "entity_transfer",
            confidence: "high",
            transferDetails: {
              suggestedEntityId: entity.id,
              suggestedEntityName: entity.name,
              suggestedEntityType: entity.entityType,
              suggestedFlow,
              suggestedDirection,
            },
          });
          break;
        }
      }
    }

    // --- Regular transaction is always a fallback ---
    candidates.push({
      type: "regular_transaction",
      confidence: candidates.length === 0 ? "high" : "low",
    });

    // --- Determine resolution state ---
    const nonRegularCandidates = candidates.filter(
      (c) => c.type !== "regular_transaction"
    );

    let resolvedClassification: ClassificationType | undefined;
    let needsResolution = false;

    if (nonRegularCandidates.length === 0) {
      resolvedClassification = "regular_transaction";
    } else if (nonRegularCandidates.length === 1) {
      resolvedClassification = nonRegularCandidates[0].type;
    } else {
      needsResolution = true;
    }

    return {
      ...tx,
      candidates,
      resolvedClassification,
      needsResolution,
    };
  });
}

// ---------------------------------------------------------------------------
// detectReconciliation: compare parsed transactions against existing DB data
// ---------------------------------------------------------------------------

const FUZZY_DATE_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export function detectReconciliation(
  transactions: NormalizedTransaction[],
  existingTransactions: ExistingTransactionData[],
  knownTransferFitIds: Set<string> = new Set()
): ReconciledTransaction[] {
  const existingByFitId = new Map<string, ExistingTransactionData>();
  for (const ex of existingTransactions) {
    if (ex.externalId) {
      existingByFitId.set(ex.externalId, ex);
    }
  }

  const usedFuzzyIds = new Set<string>();

  return transactions.map((tx) => {
    // --- Phase 0: FITID match against existing transfers ---
    if (knownTransferFitIds.has(tx.fitId)) {
      return { ...tx, status: "duplicate" as const };
    }

    // --- Phase 1: FITID exact match against existing transactions ---
    const existing = existingByFitId.get(tx.fitId);

    if (existing) {
      const diffs: FieldDiff[] = [];

      if (Math.abs(existing.amount - tx.amount) > 0.001) {
        diffs.push({
          field: "amount",
          existingValue: existing.amount.toFixed(2),
          ofxValue: tx.amount.toFixed(2),
        });
      }

      const existingDateStr = existing.date.toISOString().split("T")[0];
      const txDateStr = tx.date.toISOString().split("T")[0];
      if (existingDateStr !== txDateStr) {
        diffs.push({
          field: "date",
          existingValue: existingDateStr!,
          ofxValue: txDateStr!,
        });
      }

      if (existing.description !== tx.description) {
        diffs.push({
          field: "description",
          existingValue: existing.description,
          ofxValue: tx.description,
        });
      }

      if (diffs.length === 0) {
        return {
          ...tx,
          status: "duplicate" as const,
          existingTransactionId: existing.id,
        };
      }

      return {
        ...tx,
        status: "changed" as const,
        existingTransactionId: existing.id,
        diffs,
      };
    }

    // --- Phase 2: Fuzzy match (amount + date within ±3 days) ---
    const txTime = tx.date.getTime();
    const fuzzyMatch = existingTransactions.find((ex) => {
      if (usedFuzzyIds.has(ex.id)) return false;
      if (ex.externalId) return false;
      if (Math.abs(ex.amount - tx.amount) > 0.001) return false;
      if (ex.type !== tx.type) return false;
      const timeDiff = Math.abs(ex.date.getTime() - txTime);
      return timeDiff <= FUZZY_DATE_TOLERANCE_MS;
    });

    if (fuzzyMatch) {
      usedFuzzyIds.add(fuzzyMatch.id);
      return {
        ...tx,
        status: "fuzzy_match" as const,
        existingTransactionId: fuzzyMatch.id,
        fuzzyMatchedTransaction: {
          id: fuzzyMatch.id,
          description: fuzzyMatch.description,
          amount: fuzzyMatch.amount,
          date: fuzzyMatch.date.toISOString().split("T")[0]!,
          type: fuzzyMatch.type,
        },
      };
    }

    return { ...tx, status: "new" as const };
  });
}

// ---------------------------------------------------------------------------
// computeBalanceDiscrepancy: compare OFX ledger balance against computed sum
// ---------------------------------------------------------------------------

export interface BalanceCheck {
  computedBalance: number;
  ledgerBalance: number;
  discrepancy: number;
  isBalanced: boolean;
}

export function computeBalanceDiscrepancy(
  transactions: NormalizedTransaction[],
  ledgerBalance: number,
  startingBalance: number = 0
): BalanceCheck {
  const net = transactions.reduce((sum, tx) => {
    return sum + (tx.type === "income" ? tx.amount : -tx.amount);
  }, 0);

  const computedBalance =
    Math.round((startingBalance + net) * 100) / 100;
  const roundedLedger = Math.round(ledgerBalance * 100) / 100;
  const discrepancy =
    Math.round((roundedLedger - computedBalance) * 100) / 100;

  return {
    computedBalance,
    ledgerBalance: roundedLedger,
    discrepancy,
    isBalanced: Math.abs(discrepancy) < 0.01,
  };
}
