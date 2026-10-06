import { detectFile } from "@capital/server/modules/assistant/services/detect-and-parse-file";
import { detectBankParser, parseCsvContent, parseCsvLine, parseDate, type ParsedTransaction } from "@capital/server/modules/credit-cards/services/parsers";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { detectStatementBank, parseOfxContent, parseOfxCreditCardContent, type ParsedBankTransaction } from "./parsers";

/**
 * Reading the files of an import (no database): decoding, kind detection
 * and parsing into one merged statement. analyze-import.ts compares the
 * result with the ledger.
 */

export type ImportFileKind = "bank_ofx" | "card_ofx" | "card_csv" | "pdf" | "image";

export interface ImportFileInput {
  name?: string;
  /** File content: plain text, base64, or a base64 data URL. */
  content: string;
  /** "text" or "base64"; detected when omitted. */
  encoding?: "base64" | "text";
}

export interface DecodedImportFile {
  name: string;
  size: number;
  kind: ImportFileKind;
  buffer: Buffer;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The file's bytes. Without an explicit encoding, content that is valid
 * base64 is decoded: a statement in plain text always has characters
 * base64 never uses (separators, "<", ":"), so the two cannot be confused.
 */
export function decodeImportContent(content: string, encoding?: "base64" | "text"): Buffer {
  if (encoding === "text") return Buffer.from(content, "utf8");
  const dataUrl = content.match(/^data:[^;,]*;base64,([\s\S]*)$/);
  const raw = dataUrl ? dataUrl[1] : content;
  const compact = raw.replace(/\s+/g, "");
  if (encoding === "base64" || dataUrl || (compact.length >= 8 && compact.length % 4 === 0 && BASE64.test(compact))) {
    return Buffer.from(compact, "base64");
  }
  return Buffer.from(content, "utf8");
}

/**
 * Text of a statement file. Brazilian banks still export OFX and CSV in
 * Windows-1252 (CHARSET:1252); bytes that are not valid UTF-8 are read as
 * that, so "PAGAMENTO CARTÃO" does not turn into "PAGAMENTO CART\uFFFDO".
 */
export function statementText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/**
 * Kind of one file, from its content (the name only decides between a CSV
 * and nothing). A file that is neither OFX, PDF nor image is read as a card
 * bill CSV when it parses as one.
 */
export function detectImportKind(buffer: Buffer, name: string): ImportFileKind | null {
  const detected = detectFile(buffer, name);
  switch (detected.statementKind) {
    case "bank_ofx":
    case "card_ofx":
    case "card_csv":
      return detected.statementKind;
    case "investment_pdf":
      return "pdf";
    case "image":
      return "image";
    default:
      try {
        return parseCsvContent(statementText(buffer)).length ? "card_csv" : null;
      } catch {
        return null;
      }
  }
}

function invalidFile(err: unknown): LedgerError {
  return new LedgerError(err instanceof Error ? err.message : "Invalid statement file", 400, { code: "import.invalid_file" });
}

export function decodeImportFiles(files: ImportFileInput[]): DecodedImportFile[] {
  return files.map((file, i) => {
    const name = file.name?.trim() || `arquivo-${i + 1}`;
    const buffer = decodeImportContent(file.content, file.encoding);
    const kind = detectImportKind(buffer, name);
    if (!kind) throw new LedgerError(`${name} is not a bank statement or card bill`, 400, { code: "import.invalid_file" });
    return { name, size: buffer.byteLength, kind, buffer };
  });
}

/** "NU PAGAMENTOS S.A." → "Nubank"; unknown banks keep their own name, without the company suffix. */
export function bankDisplayName(org: string): string | null {
  const known = detectStatementBank(org)?.name;
  if (known) return known;
  const clean = org
    .replace(/\bS\.?\s?A\.?(?=\s|$)/gi, "")
    .replace(/\bS\/A\b/gi, "")
    .replace(/\bLTDA\.?/gi, "")
    .replace(/[.,]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || null;
}

const validDate = (d: Date) => !Number.isNaN(d.getTime());

// ---------------------------------------------------------------------------
// Bank statement (OFX <STMTRS>)
// ---------------------------------------------------------------------------

export interface ParsedBankImport {
  bank: string | null;
  /** ACCTID of the statement (the bank account number). */
  externalAccountId: string | null;
  currency: string;
  ledgerBalance: number | null;
  period: { from: string; to: string } | null;
  transactions: ParsedBankTransaction[];
}

/** Several OFX files of one account, merged and deduplicated by FITID. */
export function parseBankFiles(files: DecodedImportFile[]): ParsedBankImport {
  let bank: string | null = null;
  let externalAccountId: string | null = null;
  let currency = "BRL";
  let latestBalanceDate = new Date(0);
  let ledgerBalance: number | null = null;
  let from: Date | null = null;
  let to: Date | null = null;
  const seen = new Set<string>();
  const transactions: ParsedBankTransaction[] = [];

  for (const file of files) {
    let parsed: ReturnType<typeof parseOfxContent>;
    try {
      parsed = parseOfxContent(statementText(file.buffer));
    } catch (err) {
      throw invalidFile(err);
    }
    bank ??= parsed.bankName ? bankDisplayName(parsed.bankName) : null;
    externalAccountId ??= parsed.account.accountId || null;
    if (parsed.currency) currency = parsed.currency;
    if (validDate(parsed.balanceDate) && parsed.balanceDate >= latestBalanceDate) {
      latestBalanceDate = parsed.balanceDate;
      ledgerBalance = Math.round(parsed.ledgerBalance * 100) / 100;
    }
    for (const d of [parsed.dateStart, ...parsed.transactions.map((t) => t.date)]) if (validDate(d) && (!from || d < from)) from = d;
    for (const d of [parsed.dateEnd, ...parsed.transactions.map((t) => t.date)]) if (validDate(d) && (!to || d > to)) to = d;
    for (const t of parsed.transactions) {
      if (!t.fitId || seen.has(t.fitId) || Number.isNaN(t.amount) || !validDate(t.date)) continue;
      seen.add(t.fitId);
      transactions.push(t);
    }
  }
  if (!transactions.length) throw new LedgerError("No valid transactions found in the statement", 422, { code: "import.no_transactions" });
  return {
    bank,
    externalAccountId,
    currency,
    ledgerBalance,
    period: from && to ? { from: formatDateOnly(from), to: formatDateOnly(to) } : null,
    transactions,
  };
}

// ---------------------------------------------------------------------------
// Card bill (CSV or OFX <CCSTMTRS>)
// ---------------------------------------------------------------------------

export interface ParsedCardRow {
  date: string;
  description: string;
  /** Charge > 0, refund < 0 (statement convention). */
  amount: number;
  installment?: { number: number; total: number };
}

export interface ParsedCardImport {
  bank: string | null;
  /** Card number from an OFX bill (CSV bills carry none). */
  externalAccountId: string | null;
  currency: string | null;
  period: { from: string; to: string } | null;
  /** Every parsed line, payments included, for the bill total. */
  parsed: ParsedTransaction[];
  /** The purchases and refunds to book (payment lines left out). */
  rows: ParsedCardRow[];
  payments: number;
}

function csvBankName(text: string): string | null {
  const header = text.trim().split("\n")[0] ?? "";
  const separator = header.includes(";") ? ";" : ",";
  return detectBankParser(parseCsvLine(header, separator).map((h) => h.toLowerCase().trim()))?.name ?? null;
}

export function parseCardFiles(files: DecodedImportFile[]): ParsedCardImport {
  let bank: string | null = null;
  let externalAccountId: string | null = null;
  let currency: string | null = null;
  const parsed: ParsedTransaction[] = [];

  for (const file of files) {
    const text = statementText(file.buffer);
    try {
      if (file.kind === "card_ofx") {
        const ofx = parseOfxCreditCardContent(text);
        bank ??= ofx.bankName ? bankDisplayName(ofx.bankName) : null;
        externalAccountId ??= ofx.accountId || null;
        currency ??= ofx.currency || null;
        parsed.push(...ofx.transactions);
      } else {
        bank ??= csvBankName(text);
        parsed.push(...parseCsvContent(text));
      }
    } catch (err) {
      throw invalidFile(err);
    }
  }

  const rows: ParsedCardRow[] = [];
  let payments = 0;
  for (const t of parsed) {
    let date: string;
    try {
      date = formatDateOnly(parseDate(t.date));
    } catch (err) {
      throw invalidFile(err);
    }
    if (t.isPayment) {
      payments++;
      continue;
    }
    rows.push({
      date,
      description: t.description,
      amount: t.amount,
      ...(t.installmentNumber && t.totalInstallments && t.totalInstallments > 1 && { installment: { number: t.installmentNumber, total: t.totalInstallments } }),
    });
  }
  if (!rows.length) throw new LedgerError("No valid transactions found in the bill file", 422, { code: "import.no_transactions" });
  // The cycle's purchases: installments carry the date of the original purchase.
  const dates = (rows.some((r) => !r.installment) ? rows.filter((r) => !r.installment) : rows).map((r) => r.date).sort();
  return { bank, externalAccountId, currency, period: { from: dates[0], to: dates[dates.length - 1] }, parsed, rows, payments };
}

/** Last four digits of an account or card number ("•••• 1234", "5502 **** 1234" → "1234"). */
export function lastDigits(value: string | null | undefined, n = 4): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= n ? digits.slice(-n) : null;
}

/**
 * Whether a statement's account number names this account. Reduced to
 * letters and digits, one must end with the other, the shorter having at
 * least four characters: the account may hold only the last digits, or
 * the branch before the number ("0001 / 47404983-7" for ACCTID 47404983-7).
 */
export function accountNumberMatches(fromFile: string | null, externalId: string | null): boolean {
  const a = (fromFile ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  const b = (externalId ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.endsWith(short);
}
