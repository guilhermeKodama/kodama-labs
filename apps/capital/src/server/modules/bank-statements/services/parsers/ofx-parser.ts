import type { ParsedStatement, ParsedBankTransaction, ParsedStatementAccount } from "./types";
import type { ParsedTransaction } from "@capital/server/modules/credit-cards/services/parsers/types";

/**
 * Extract the text content of an OFX/SGML tag.
 * Handles both self-closing patterns: <TAG>value and <TAG>value</TAG>
 */
function extractTag(content: string, tag: string): string {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const startIdx = content.indexOf(openTag);
  if (startIdx === -1) return "";

  const valueStart = startIdx + openTag.length;
  const closeIdx = content.indexOf(closeTag, valueStart);
  const nextOpenIdx = content.indexOf("<", valueStart);

  let valueEnd: number;
  if (closeIdx !== -1 && (nextOpenIdx === -1 || closeIdx <= nextOpenIdx)) {
    valueEnd = closeIdx;
  } else if (nextOpenIdx !== -1) {
    valueEnd = nextOpenIdx;
  } else {
    valueEnd = content.length;
  }

  return content.substring(valueStart, valueEnd).trim();
}

/**
 * Extract a block of content between an opening tag and its closing tag.
 * Works for aggregate tags like <STMTTRN>...</STMTTRN>
 */
function extractBlock(content: string, tag: string): string {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const start = content.indexOf(openTag);
  if (start === -1) return "";

  const end = content.indexOf(closeTag, start);
  if (end === -1) return content.substring(start + openTag.length);

  return content.substring(start + openTag.length, end);
}

/**
 * Extract all blocks matching a tag (for repeated elements like STMTTRN).
 */
function extractAllBlocks(content: string, tag: string): string[] {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const blocks: string[] = [];
  let searchFrom = 0;

  while (true) {
    const start = content.indexOf(openTag, searchFrom);
    if (start === -1) break;

    const end = content.indexOf(closeTag, start);
    if (end === -1) break;

    blocks.push(content.substring(start + openTag.length, end));
    searchFrom = end + closeTag.length;
  }

  return blocks;
}

/**
 * Parse OFX date format: YYYYMMDDHHMMSS[offset:TZ] or YYYYMMDD
 * Returns a Date normalized to noon UTC for the given day.
 */
export function parseOfxDate(dateStr: string): Date {
  const cleaned = dateStr.replace(/\[.*\]/, "").trim();
  const year = parseInt(cleaned.substring(0, 4), 10);
  const month = parseInt(cleaned.substring(4, 6), 10) - 1;
  const day = parseInt(cleaned.substring(6, 8), 10);
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
}

function parseAccount(stmtrs: string): ParsedStatementAccount {
  const acctFrom = extractBlock(stmtrs, "BANKACCTFROM");
  return {
    bankId: extractTag(acctFrom, "BANKID"),
    branchId: extractTag(acctFrom, "BRANCHID"),
    accountId: extractTag(acctFrom, "ACCTID"),
    accountType: extractTag(acctFrom, "ACCTTYPE"),
  };
}

function parseTransaction(block: string): ParsedBankTransaction {
  return {
    trnType: extractTag(block, "TRNTYPE"),
    date: parseOfxDate(extractTag(block, "DTPOSTED")),
    amount: parseFloat(extractTag(block, "TRNAMT")),
    fitId: extractTag(block, "FITID"),
    memo: extractTag(block, "MEMO"),
  };
}

/**
 * Parse a raw OFX file string into a structured ParsedStatement.
 */
export function parseOfxContent(raw: string): ParsedStatement {
  const fi = extractBlock(raw, "FI");
  const bankName = extractTag(fi, "ORG");
  const bankFid = extractTag(fi, "FID");

  const stmtrs = extractBlock(raw, "STMTRS");
  if (!stmtrs) {
    throw new Error("No STMTRS block found in OFX file");
  }

  const currency = extractTag(stmtrs, "CURDEF");
  const account = parseAccount(stmtrs);

  const tranList = extractBlock(stmtrs, "BANKTRANLIST");
  const dateStart = parseOfxDate(extractTag(tranList, "DTSTART"));
  const dateEnd = parseOfxDate(extractTag(tranList, "DTEND"));

  const trnBlocks = extractAllBlocks(tranList, "STMTTRN");
  const transactions = trnBlocks.map(parseTransaction);

  const ledgerBal = extractBlock(stmtrs, "LEDGERBAL");
  const ledgerBalance = parseFloat(extractTag(ledgerBal, "BALAMT")) || 0;
  const balanceDateStr = extractTag(ledgerBal, "DTASOF");
  const balanceDate = balanceDateStr ? parseOfxDate(balanceDateStr) : dateEnd;

  return {
    bankName,
    bankFid,
    account,
    currency,
    dateStart,
    dateEnd,
    transactions,
    ledgerBalance,
    balanceDate,
  };
}

/** Keywords (lowercase) identifying a card-payment line, mirroring the CSV bank parsers' paymentKeywords. */
const CC_PAYMENT_KEYWORDS = ["pagamento recebido", "pagamento efetuado", "payment received", "payment thank you"];

function isOfxCreditCardPayment(trnType: string, memo: string): boolean {
  if (trnType.toUpperCase() === "PAYMENT") return true;
  const lower = memo.toLowerCase();
  return CC_PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

export interface ParsedOfxCreditCardStatement {
  bankName: string;
  accountId: string;
  currency: string;
  transactions: ParsedTransaction[];
}

/**
 * Parse a credit-card OFX statement (<CCSTMTRS>, distinct from the
 * <STMTRS> a checking/savings statement uses - some banks, Nubank
 * included, export card bills as OFX rather than CSV). Produces the same
 * ParsedTransaction[] shape the CSV parsers do, so everything downstream
 * of parsing (bill creation, categorization, installment linking) never
 * needs to know which format the file came in as.
 *
 * OFX's sign convention for a credit card is the same as for a checking
 * account: a charge is a negative TRNAMT (money leaving available
 * credit), a payment is positive. That is the OPPOSITE of this app's CSV
 * convention (positive = charge), so amounts are flipped here. isPayment
 * is judged by TRNTYPE/MEMO, not by sign alone - a refund/estorno is
 * also amount-negative post-flip but must still become a BillTransaction
 * (calculateBillTotal decides whether it belongs to the current cycle),
 * not be dropped like the card-payment line is.
 */
export function parseOfxCreditCardContent(raw: string): ParsedOfxCreditCardStatement {
  const fi = extractBlock(raw, "FI");
  const bankName = extractTag(fi, "ORG");

  const ccstmtrs = extractBlock(raw, "CCSTMTRS");
  if (!ccstmtrs) {
    throw new Error("No CCSTMTRS block found in OFX file");
  }

  const currency = extractTag(ccstmtrs, "CURDEF");
  const acctFrom = extractBlock(ccstmtrs, "CCACCTFROM");
  const accountId = extractTag(acctFrom, "ACCTID");

  const tranList = extractBlock(ccstmtrs, "BANKTRANLIST");
  const trnBlocks = extractAllBlocks(tranList, "STMTTRN");

  const transactions: ParsedTransaction[] = trnBlocks.map((block) => {
    const trnType = extractTag(block, "TRNTYPE");
    const memo = extractTag(block, "MEMO");
    const amount = -parseFloat(extractTag(block, "TRNAMT"));
    return {
      date: extractTag(block, "DTPOSTED").slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
      description: memo,
      amount,
      isPayment: isOfxCreditCardPayment(trnType, memo),
    };
  });

  return { bankName, accountId, currency: currency || "BRL", transactions };
}
