/**
 * Multi-bank CSV bill parser.
 *
 * Entry point: `parseCsvContent(csvContent)` auto-detects the bank format
 * and delegates to the matching parser config.
 */

export type { ParsedTransaction, BankParserConfig, InstallmentInfo } from "./types";
export { parseDate, parseAmount, parseCsvLine, computeCycleStart } from "./utils";
export { detectBankParser } from "./detect-bank";

import type { ParsedTransaction } from "./types";
import type { BankParserConfig } from "./types";
import { parseCsvLine, parseAmount } from "./utils";
import { detectBankParser, buildFallbackParser } from "./detect-bank";

/**
 * Check if a description refers to a payment to the card.
 */
function isPaymentLine(description: string, keywords: string[]): boolean {
  const lower = description.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Find the index of a header that matches one of the candidate names.
 */
function findHeaderIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.includes(h));
}

/**
 * Parse CSV content from a credit card bill.
 * Auto-detects the bank format from headers and delegates to the matching parser.
 */
export function parseCsvContent(csvContent: string): ParsedTransaction[] {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have at least a header and one data row");
  }

  const headerLine = lines[0];
  const transactions: ParsedTransaction[] = [];

  // Detect separator
  const separator = headerLine.includes(";") ? ";" : ",";
  const headers = parseCsvLine(headerLine, separator).map((h) => h.toLowerCase().trim());

  // Detect bank or fall back to generic parser
  const parser: BankParserConfig = detectBankParser(headers) ?? buildFallbackParser(headers);

  // Find column indices using the parser's header lists
  const dateIdx = findHeaderIndex(headers, parser.dateHeaders);
  const descIdx = findHeaderIndex(headers, parser.descriptionHeaders);
  const amountIdx = findHeaderIndex(headers, parser.amountHeaders);

  // Optional installment column
  const installmentIdx = parser.installmentColumn
    ? headers.findIndex((h) => h === parser.installmentColumn)
    : -1;

  // Determine column mapping (fallback to positional if detection fails)
  const useFallback = dateIdx === -1 || descIdx === -1 || amountIdx === -1;
  const dIdx = useFallback ? 0 : dateIdx;
  const tIdx = useFallback ? 1 : descIdx;
  const aIdx = useFallback ? 2 : amountIdx;
  const minCols = Math.max(dIdx, tIdx, aIdx) + 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line, separator);
    if (cols.length < minCols) continue;

    const rawDescription = cols[tIdx];
    const amount = parseAmount(cols[aIdx]);
    if (isNaN(amount)) continue;

    const payment = isPaymentLine(rawDescription, parser.paymentKeywords);

    // Determine installment info: from dedicated column or from description
    let installmentNumber: number | undefined;
    let totalInstallments: number | undefined;
    let cleanDescription: string;

    if (installmentIdx !== -1 && parser.parseInstallmentFromColumn && cols[installmentIdx]) {
      const colInfo = parser.parseInstallmentFromColumn(cols[installmentIdx]);
      installmentNumber = colInfo.installmentNumber;
      totalInstallments = colInfo.totalInstallments;
      // When installments come from a column, description is already clean
      cleanDescription = rawDescription;
    } else {
      const descInfo = parser.parseInstallmentFromDescription(rawDescription);
      installmentNumber = descInfo.installmentNumber;
      totalInstallments = descInfo.totalInstallments;
      cleanDescription = descInfo.cleanDescription;
    }

    transactions.push({
      date: cols[dIdx],
      description: cleanDescription,
      amount, // Keep original sign: positive = charge, negative = refund/credit
      installmentNumber,
      totalInstallments,
      isPayment: payment,
    });
  }

  return transactions;
}
