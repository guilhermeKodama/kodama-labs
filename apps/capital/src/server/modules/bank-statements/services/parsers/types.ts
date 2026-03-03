export interface ParsedBankTransaction {
  fitId: string;
  date: Date;
  amount: number;
  memo: string;
  trnType: "CREDIT" | "DEBIT" | string;
}

export interface ParsedStatementAccount {
  bankId: string;
  branchId: string;
  accountId: string;
  accountType: string;
}

export interface ParsedStatement {
  bankName: string;
  bankFid: string;
  account: ParsedStatementAccount;
  currency: string;
  dateStart: Date;
  dateEnd: Date;
  transactions: ParsedBankTransaction[];
  ledgerBalance: number;
  balanceDate: Date;
}

/**
 * Extensible per-bank config for OFX parsing.
 * To add a new bank: create a file exporting a StatementParserConfig
 * and register it in detect-bank.ts.
 */
export interface StatementParserConfig {
  name: string;
  detect(orgName: string): boolean;
  /** Optional post-processing of parsed transactions */
  transformTransaction?(tx: ParsedBankTransaction): ParsedBankTransaction;
}
