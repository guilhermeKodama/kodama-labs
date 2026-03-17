import type { ParsedBankTransaction } from "./parsers/types";
import { extractShortTitle } from "../utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClassificationType =
  | "regular_transaction"
  | "entity_transfer"
  | "investment_transfer"
  | "credit_card_payment";

export type Confidence = "high" | "medium" | "low";

export type TransferDirection =
  | "profit_distribution"
  | "capital_injection"
  | "reimbursement";

export type InvestmentDirection =
  | "investment_deposit"
  | "investment_withdrawal";

export interface TransferDetails {
  suggestedEntityId: string;
  suggestedEntityName: string;
  suggestedEntityType: "business" | "personal";
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

export type ReconciliationStatus = "new" | "duplicate" | "changed";

export interface FieldDiff {
  field: "amount" | "date" | "description";
  existingValue: string;
  ofxValue: string;
}

export interface ReconciledTransaction extends NormalizedTransaction {
  status: ReconciliationStatus;
  existingTransactionId?: string;
  diffs?: FieldDiff[];
}

export interface ExistingTransactionData {
  id: string;
  externalId: string;
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

export function classifyTransactions(
  transactions: NormalizedTransaction[],
  entities: EntityInfo[],
  investmentAccounts: InvestmentAccountInfo[] = [],
  bankName: string = ""
): ClassifiedTransaction[] {
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
          const suggestedDirection: TransferDirection =
            tx.type === "expense" ? "capital_injection" : "profit_distribution";

          candidates.push({
            type: "entity_transfer",
            confidence: "high",
            transferDetails: {
              suggestedEntityId: entity.id,
              suggestedEntityName: entity.name,
              suggestedEntityType: entity.entityType,
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

export function detectReconciliation(
  transactions: NormalizedTransaction[],
  existingTransactions: ExistingTransactionData[]
): ReconciledTransaction[] {
  const existingMap = new Map<string, ExistingTransactionData>();
  for (const ex of existingTransactions) {
    if (ex.externalId) {
      existingMap.set(ex.externalId, ex);
    }
  }

  return transactions.map((tx) => {
    const existing = existingMap.get(tx.fitId);

    if (!existing) {
      return { ...tx, status: "new" as const };
    }

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
