import type { StatementFileType } from "@/generated/prisma";
import { parseOfxContent, parseOfxCreditCardContent } from "@capital/server/modules/bank-statements/services/parsers";
import { normalizeTransactions } from "@capital/server/modules/bank-statements/services/reconciliation";
import { parseCsvContent } from "@capital/server/modules/credit-cards/services/parsers";
import { toDateString } from "@capital/server/lib/date-utils";

export interface DetectedFile {
  fileType: StatementFileType;
  statementKind: "bank_ofx" | "card_ofx" | "card_csv" | "investment_pdf" | "unknown";
}

/**
 * Sniff the real file type from content, not the declared mime type - OFX
 * routinely arrives as text/plain or application/octet-stream depending on
 * the bank's export tool, so trusting Content-Type would reject legitimate
 * files. A credit card bill can arrive as OFX too (some banks, Nubank
 * included, export it this way instead of CSV) - <CCSTMTRS> distinguishes
 * it from a checking/savings <STMTRS> statement.
 */
export function detectFile(buffer: Buffer, originalName: string): DetectedFile {
  const head = buffer.subarray(0, 4096).toString("utf8");
  if (/OFXHEADER|<OFX>/i.test(head)) {
    if (/<CCSTMTRS>/i.test(head)) {
      return { fileType: "ofx", statementKind: "card_ofx" };
    }
    return { fileType: "ofx", statementKind: "bank_ofx" };
  }
  if (buffer.subarray(0, 4).toString("latin1") === "%PDF") {
    return { fileType: "pdf", statementKind: "investment_pdf" };
  }
  if (/\.csv$/i.test(originalName)) {
    return { fileType: "csv", statementKind: "card_csv" };
  }
  return { fileType: "csv", statementKind: "unknown" };
}

export interface OfxParsedPayload {
  kind: "bank_ofx";
  bankName: string;
  accountId: string;
  currency: string;
  ledgerBalance: number;
  balanceDate: string;
  dateStart: string;
  dateEnd: string;
  rows: Array<{
    fitId: string;
    date: string;
    description: string;
    fullDescription: string;
    amount: number;
    type: "income" | "expense";
  }>;
}

// "card_csv" regardless of whether the source was actually a CSV or a
// card OFX (<CCSTMTRS>) - the kind names the shape of the data (bill line
// items), not the file format it arrived in.
export interface CsvParsedPayload {
  kind: "card_csv";
  rows: Array<{
    date: string;
    description: string;
    amount: number;
    installmentNumber?: number;
    totalInstallments?: number;
    isPayment: boolean;
  }>;
}

export type ParsedPayload = OfxParsedPayload | CsvParsedPayload;

export interface ParseFileResult {
  parseStatus: "parsed" | "failed" | "not_applicable";
  parsedPayload?: ParsedPayload;
  parseError?: string;
  /** Row count surfaced on the file chip/context panel without re-reading parsedPayload. */
  rowCount?: number;
}

/**
 * Parse OFX/CSV deterministically at upload time so the agent never has to
 * transcribe a statement - it reads structured rows via the
 * get_parsed_rows tool instead. PDFs are not parsed here; they are handed
 * to Claude as document blocks when a turn references them.
 */
export function parseStatementFile(
  buffer: Buffer,
  detected: DetectedFile
): ParseFileResult {
  if (detected.fileType === "pdf") {
    return { parseStatus: "not_applicable" };
  }

  const text = buffer.toString("utf8");

  if (detected.fileType === "ofx" && detected.statementKind === "card_ofx") {
    try {
      const parsed = parseOfxCreditCardContent(text);
      const payload: CsvParsedPayload = {
        kind: "card_csv",
        rows: parsed.transactions.map((r) => ({
          date: r.date,
          description: r.description,
          amount: r.amount,
          installmentNumber: r.installmentNumber,
          totalInstallments: r.totalInstallments,
          isPayment: r.isPayment,
        })),
      };
      return { parseStatus: "parsed", parsedPayload: payload, rowCount: payload.rows.length };
    } catch (error) {
      return {
        parseStatus: "failed",
        parseError: error instanceof Error ? error.message : "Falha ao ler o OFX de cartão",
      };
    }
  }

  if (detected.fileType === "ofx") {
    try {
      const parsed = parseOfxContent(text);
      const normalized = normalizeTransactions(parsed.transactions);
      const payload: OfxParsedPayload = {
        kind: "bank_ofx",
        bankName: parsed.bankName,
        accountId: parsed.account.accountId,
        currency: parsed.currency || "BRL",
        ledgerBalance: Math.round(parsed.ledgerBalance * 100) / 100,
        balanceDate: toDateString(parsed.balanceDate),
        dateStart: toDateString(parsed.dateStart),
        dateEnd: toDateString(parsed.dateEnd),
        rows: normalized.map((row) => ({
          fitId: row.fitId,
          date: toDateString(row.date),
          description: row.description,
          fullDescription: row.fullDescription,
          amount: row.amount,
          type: row.type,
        })),
      };
      return { parseStatus: "parsed", parsedPayload: payload, rowCount: payload.rows.length };
    } catch (error) {
      return {
        parseStatus: "failed",
        parseError: error instanceof Error ? error.message : "Falha ao ler o OFX",
      };
    }
  }

  // CSV (card bill or unrecognized-but-.csv)
  try {
    const rows = parseCsvContent(text);
    const payload: CsvParsedPayload = {
      kind: "card_csv",
      rows: rows.map((r) => ({
        date: r.date,
        description: r.description,
        amount: r.amount,
        installmentNumber: r.installmentNumber,
        totalInstallments: r.totalInstallments,
        isPayment: r.isPayment,
      })),
    };
    return { parseStatus: "parsed", parsedPayload: payload, rowCount: payload.rows.length };
  } catch (error) {
    return {
      parseStatus: "failed",
      parseError: error instanceof Error ? error.message : "Falha ao ler o CSV",
    };
  }
}
