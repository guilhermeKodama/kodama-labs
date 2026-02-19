/**
 * Parsed transaction from a credit card bill CSV.
 */
export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  installmentNumber?: number;
  totalInstallments?: number;
  isPayment: boolean; // True for payment-to-card lines (e.g. "Pagamento recebido")
}

/**
 * Result of parsing installment information.
 */
export interface InstallmentInfo {
  installmentNumber?: number;
  totalInstallments?: number;
  cleanDescription: string;
}

/**
 * Configuration for a bank-specific CSV parser.
 *
 * To add a new bank:
 * 1. Create a new file (e.g. `itau.ts`) exporting a BankParserConfig
 * 2. Register it in the `bankParsers` array in `detect-bank.ts`
 */
export interface BankParserConfig {
  /** Display name (e.g. "Nubank", "XP") */
  name: string;

  /** Returns true if the CSV headers match this bank's format */
  detect(headers: string[]): boolean;

  /** Header names that map to the date column (lowercase) */
  dateHeaders: string[];

  /** Header names that map to the description column (lowercase) */
  descriptionHeaders: string[];

  /** Header names that map to the amount column (lowercase) */
  amountHeaders: string[];

  /**
   * Optional header name for a separate installment column (lowercase).
   * If set, installments are read from this column instead of the description.
   * Example: XP uses a "parcela" column with values like "11 de 12".
   */
  installmentColumn?: string;

  /**
   * Parse installment info from a dedicated column value.
   * Only used when `installmentColumn` is set.
   * Should return undefined fields when the value indicates no installment (e.g. "-").
   */
  parseInstallmentFromColumn?(value: string): {
    installmentNumber?: number;
    totalInstallments?: number;
  };

  /**
   * Parse installment info embedded in the description string.
   * Returns cleaned description + optional installment numbers.
   */
  parseInstallmentFromDescription(description: string): InstallmentInfo;

  /**
   * Keywords (lowercase) that identify payment-to-card lines.
   * Matched via `includes` against the lowercase description.
   */
  paymentKeywords: string[];
}
