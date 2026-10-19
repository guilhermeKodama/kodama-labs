import type { DividendOrigin } from "@/generated/prisma";

export type IncomeKind = "fii_income" | "dividend" | "jcp" | "interest";

export interface ClassifiedIncome {
  event: "income";
  incomeType: IncomeKind;
  origin: DividendOrigin | null;
  /** Gross amount. The cash credited is gross − tax. */
  gross: number;
  taxWithheld: number;
  confidence: number;
  source: "rule" | "llm";
}

export interface ClassifiedOther {
  event: "amortization" | "buy" | "sell" | "skip";
  gross: number;
  confidence: number;
  source: "rule";
}

export type Classification = ClassifiedIncome | ClassifiedOther;

export interface ClassifyInput {
  type: string;
  amount: number;
  netAmount?: number | null;
  incomeTax?: number | null;
  description?: string | null;
  ticker?: string | null;
  assetType?: string | null;
  assetSubtype?: string | null;
  assetName?: string | null;
}

export interface IncomeGuess {
  incomeType: IncomeKind;
  origin: DividendOrigin | null;
  confidence: number;
}

export type IncomeGuesser = (input: ClassifyInput) => Promise<IncomeGuess | null>;

const LOW_CONFIDENCE = 0.8;

export function needsReview(result: Classification): boolean {
  return result.event === "income" && result.confidence < LOW_CONFIDENCE;
}

function tickerOf(input: ClassifyInput): string {
  return (input.ticker ?? "").trim().toUpperCase();
}

function isBdr(ticker: string): boolean {
  return /3[2-5]$/.test(ticker);
}

function isFii(input: ClassifyInput, ticker: string): boolean {
  if ((input.assetSubtype ?? "").toUpperCase() === "REAL_ESTATE_FUND") return true;
  return /11$/.test(ticker) && !isBdr(ticker);
}

function isBrazilianStock(input: ClassifyInput, ticker: string): boolean {
  if (isBdr(ticker) || isFii(input, ticker)) return false;
  if ((input.assetSubtype ?? "").toUpperCase() === "STOCK") return true;
  return /^[A-Z]{4}\d$/.test(ticker);
}

function isFixedIncome(input: ClassifyInput): boolean {
  const type = (input.assetType ?? "").toUpperCase();
  const sub = (input.assetSubtype ?? "").toUpperCase();
  if (type === "FIXED_INCOME") return true;
  return ["CDB", "RDB", "LCI", "LCA", "CRI", "CRA", "TREASURY", "DEBENTURES"].includes(sub);
}

function mentionsJcp(description: string | null | undefined): boolean {
  return /jcp|jscp|juros sobre capital/i.test(description ?? "");
}

function income(partial: Omit<ClassifiedIncome, "event" | "source" | "confidence"> & { confidence?: number }): ClassifiedIncome {
  return { event: "income", source: "rule", confidence: partial.confidence ?? 1, ...partial };
}

/**
 * Deterministic pass. Returns null when an INTEREST row is not decided by
 * the asset, the ticker or the description — the caller asks the model.
 * Amortization, trades, transfers and tax never become income.
 */
export function classifyByRule(input: ClassifyInput): Classification | null {
  const type = input.type.toUpperCase();
  const gross = Math.abs(input.amount);
  const ticker = tickerOf(input);
  if (type === "AMORTIZATION") return { event: "amortization", gross, confidence: 1, source: "rule" };
  if (type === "BUY") return { event: "buy", gross, confidence: 1, source: "rule" };
  if (type === "SELL") return { event: "sell", gross, confidence: 1, source: "rule" };
  if (type === "TRANSFER" || type === "TAX") return { event: "skip", gross, confidence: 1, source: "rule" };
  if (type !== "INTEREST") return { event: "skip", gross, confidence: 1, source: "rule" };

  const tax = Math.max(0, input.incomeTax ?? 0);
  if (isFii(input, ticker)) return income({ incomeType: "fii_income", origin: null, gross, taxWithheld: 0 });
  if (isBdr(ticker)) return income({ incomeType: "dividend", origin: "bdr", gross, taxWithheld: tax });
  if (mentionsJcp(input.description) || (tax > 0 && isBrazilianStock(input, ticker))) {
    return income({ incomeType: "jcp", origin: null, gross, taxWithheld: tax });
  }
  if (isBrazilianStock(input, ticker)) return income({ incomeType: "dividend", origin: "br", gross, taxWithheld: 0 });
  if (isFixedIncome(input)) return income({ incomeType: "interest", origin: null, gross, taxWithheld: tax });
  return null;
}

export async function classifyInvestment(input: ClassifyInput, guess: IncomeGuesser | null): Promise<Classification> {
  const ruled = classifyByRule(input);
  if (ruled) return ruled;
  const gross = Math.abs(input.amount);
  const guessed = guess ? await guess(input) : null;
  if (!guessed) {
    return { event: "income", incomeType: "interest", origin: null, gross, taxWithheld: Math.max(0, input.incomeTax ?? 0), confidence: 0, source: "llm" };
  }
  const origin: DividendOrigin | null = guessed.incomeType === "dividend" ? guessed.origin : null;
  return {
    event: "income",
    incomeType: guessed.incomeType,
    origin,
    gross,
    taxWithheld: Math.max(0, input.incomeTax ?? 0),
    confidence: Math.min(1, Math.max(0, guessed.confidence)),
    source: "llm",
  };
}
