import type { ParsedStatement, ParsedBankTransaction, ParsedStatementAccount } from "./types";

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
