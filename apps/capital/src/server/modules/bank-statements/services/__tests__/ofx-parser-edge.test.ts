import { describe, expect, it } from "vitest";
import { parseOfxContent, parseOfxCreditCardContent } from "../parsers";

/** Statement files as banks really export them: SGML with no closing tags, missing blocks, missing optional tags. */

describe("parseOfxContent on loose SGML", () => {
  it("reads a value that runs to the end of the file when no tag follows it", () => {
    const parsed = parseOfxContent("<OFX><STMTRS><CURDEF>BRL</CURDEF><BANKACCTFROM><ACCTID>12345");
    expect(parsed.account.accountId).toBe("12345");
    expect(parsed.currency).toBe("BRL");
  });

  it("reads an unclosed aggregate block up to the end of the file", () => {
    const parsed = parseOfxContent("<OFX><STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>7<ACCTID>999<ACCTTYPE>CHECKING");
    expect(parsed.account).toEqual({ bankId: "7", branchId: "", accountId: "999", accountType: "CHECKING" });
  });

  it("stops a tag's value at the next tag when the closing tag comes later", () => {
    const parsed = parseOfxContent("<OFX><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>55<ACCTTYPE>SAVINGS</ACCTTYPE></BANKACCTFROM></STMTRS></OFX>");
    expect(parsed.currency).toBe("EUR");
    expect(parsed.account.accountId).toBe("55");
  });

  it("takes zero for a missing or unreadable balance and the end of the period for a missing balance date", () => {
    const base = (ledger: string) =>
      `<OFX><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST><DTSTART>20260901</DTSTART><DTEND>20260930</DTEND></BANKTRANLIST>${ledger}</STMTRS></OFX>`;
    const none = parseOfxContent(base(""));
    expect(none.ledgerBalance).toBe(0);
    expect(none.balanceDate.toISOString()).toBe("2026-09-30T12:00:00.000Z");
    const bad = parseOfxContent(base("<LEDGERBAL><BALAMT>abc</BALAMT></LEDGERBAL>"));
    expect(bad.ledgerBalance).toBe(0);
    expect(bad.balanceDate.toISOString()).toBe("2026-09-30T12:00:00.000Z");
    const full = parseOfxContent(base("<LEDGERBAL><BALAMT>-12.50</BALAMT><DTASOF>20260915000000[-3:BRT]</DTASOF></LEDGERBAL>"));
    expect(full.ledgerBalance).toBe(-12.5);
    expect(full.balanceDate.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("returns no transactions for an unclosed STMTTRN block and no bank for a file without FI", () => {
    const parsed = parseOfxContent("<OFX><STMTRS><BANKTRANLIST><STMTTRN><FITID>x1<TRNAMT>-1.00</BANKTRANLIST></STMTRS></OFX>");
    expect(parsed.transactions).toEqual([]);
    expect(parsed.bankName).toBe("");
    expect(parsed.bankFid).toBe("");
  });

  it("refuses a file with no statement block", () => {
    expect(() => parseOfxContent("<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>")).toThrow("No STMTRS block found in OFX file");
  });
});

describe("parseOfxCreditCardContent on loose SGML", () => {
  const card = (lines: string, head = "<CURDEF>BRL") =>
    `<OFX><CCSTMTRS>${head}<CCACCTFROM><ACCTID>4321</CCACCTFROM><BANKTRANLIST><DTSTART>20260806<DTEND>20260905${lines}</BANKTRANLIST></CCSTMTRS></OFX>`;
  const line = (trnType: string, memo: string, amount = "-10.00", fit = "f1") =>
    `<STMTTRN><TRNTYPE>${trnType}<DTPOSTED>20260810120000<TRNAMT>${amount}<FITID>${fit}<MEMO>${memo}</STMTTRN>`;

  it("takes a PAYMENT transaction for a payment whatever its memo says, and a refund for a refund", () => {
    const parsed = parseOfxCreditCardContent(card(line("PAYMENT", "Obrigado", "500.00", "p1") + line("CREDIT", "Estorno loja", "20.00", "r1") + line("DEBIT", "Payment Thank You", "100.00", "p2")));
    expect(parsed.transactions.map((t) => [t.externalId, t.amount, t.isPayment])).toEqual([
      ["p1", -500, true],
      ["r1", -20, false],
      ["p2", -100, true],
    ]);
  });

  it("assumes BRL when the file names no currency, and leaves the FITID off a line that has none", () => {
    const parsed = parseOfxCreditCardContent(card(line("DEBIT", "Cafe", "-9.90", ""), ""));
    expect(parsed.currency).toBe("BRL");
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]).not.toHaveProperty("externalId");
    expect(parsed.dateStart).toBe("2026-08-06");
    expect(parsed.dateEnd).toBe("2026-09-05");
  });

  it("states no range when the dates are not dates", () => {
    const parsed = parseOfxCreditCardContent("<OFX><CCSTMTRS><CCACCTFROM><ACCTID>1</CCACCTFROM><BANKTRANLIST><DTSTART>soon<DTEND></BANKTRANLIST></CCSTMTRS></OFX>");
    expect(parsed).toMatchObject({ dateStart: null, dateEnd: null, transactions: [] });
  });
});
