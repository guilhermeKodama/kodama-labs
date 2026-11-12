import { describe, expect, it } from "vitest";
import { detectFile, parseStatementFile } from "../detect-and-parse-file";

/**
 * parseStatementFile with the real parsers: what the agent later reads back
 * through get_parsed_rows is exactly this payload, so the shape (signs,
 * rounding, date format) is asserted row by row. Detection edge cases that
 * the sibling detect-and-parse-file.test.ts does not reach are here too.
 */

const BANK_OFX = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "VERSION:102",
  "<OFX>",
  "<SIGNONMSGSRSV1><SONRS><FI><ORG>NU PAGAMENTOS</ORG><FID>260</FID></FI></SONRS></SIGNONMSGSRSV1>",
  "<BANKMSGSRSV1><STMTTRNRS><STMTRS>",
  "<CURDEF>BRL",
  "<BANKACCTFROM><BANKID>0260<BRANCHID>0001<ACCTID>43621320-1<ACCTTYPE>CHECKING</BANKACCTFROM>",
  "<BANKTRANLIST>",
  "<DTSTART>20260101000000[-3:BRT]",
  "<DTEND>20260131235959[-3:BRT]",
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110120000[-3:BRT]<TRNAMT>-1000.50<FITID>fit-1<MEMO>Transferência enviada pelo Pix - JOAO - 123 - BANCO</STMTTRN>",
  "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260111120000[-3:BRT]<TRNAMT>500.00<FITID>fit-2<MEMO>Transferência recebida pelo Pix - MARIA - 456 - BANCO</STMTTRN>",
  "</BANKTRANLIST>",
  "<LEDGERBAL><BALAMT>2500.126<DTASOF>20260131120000[-3:BRT]</LEDGERBAL>",
  "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
  "</OFX>",
].join("\n");

const CARD_OFX = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "<OFX>",
  "<SIGNONMSGSRSV1><SONRS><FI><ORG>NU PAGAMENTOS</ORG></FI></SONRS></SIGNONMSGSRSV1>",
  "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>",
  "<CURDEF>BRL",
  "<CCACCTFROM><ACCTID>card-abc</CCACCTFROM>",
  "<BANKTRANLIST>",
  "<DTSTART>20260101",
  "<DTEND>20260131",
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-120.00<FITID>c1<MEMO>Mercado - Parcela 2/3</STMTTRN>",
  "<STMTTRN><TRNTYPE>PAYMENT<DTPOSTED>20260112<TRNAMT>500.00<FITID>c2<MEMO>Pagamento recebido</STMTTRN>",
  "</BANKTRANLIST>",
  "</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>",
  "</OFX>",
].join("\n");

describe("detectFile - corners", () => {
  it("finds an OFX by its <OFX> tag even without an OFXHEADER, in any case", () => {
    expect(detectFile(Buffer.from("<ofx><bankmsgsrsv1></ofx>"), "x.txt")).toMatchObject({ fileType: "ofx", statementKind: "bank_ofx" });
  });

  it("reads the card marker case-insensitively", () => {
    expect(detectFile(Buffer.from("OFXHEADER:100\n<ccstmtrs>"), "x.ofx").statementKind).toBe("card_ofx");
  });

  it("only looks for the OFX markers in the first 4096 bytes", () => {
    const late = Buffer.concat([Buffer.alloc(5000, "x"), Buffer.from("OFXHEADER:100")]);
    expect(detectFile(late, "late.csv")).toMatchObject({ fileType: "csv", statementKind: "card_csv" });
  });

  it("does not take a RIFF container that is not WEBP for an image", () => {
    const wav = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE", "latin1"), Buffer.alloc(8)]);
    expect(detectFile(wav, "som.wav")).toEqual({ fileType: "csv", statementKind: "unknown" });
  });

  it("does not take a GIF-like header of another version for a GIF", () => {
    expect(detectFile(Buffer.concat([Buffer.from("GIF90a", "latin1"), Buffer.alloc(16)]), "x.gif").statementKind).toBe("unknown");
  });

  it("does not take a PNG signature with a wrong tail for a PNG", () => {
    const almost = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]), Buffer.alloc(16)]);
    expect(detectFile(almost, "x.png").statementKind).toBe("unknown");
  });

  it("matches the .csv extension in any case, and only at the end of the name", () => {
    expect(detectFile(Buffer.from("a,b"), "FATURA.CSV").statementKind).toBe("card_csv");
    expect(detectFile(Buffer.from("a,b"), "fatura.csv.txt").statementKind).toBe("unknown");
  });
});

describe("parseStatementFile - PDF", () => {
  it("leaves a PDF unparsed for the model to read", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(32)]);
    expect(parseStatementFile(pdf, detectFile(pdf, "nota.pdf"))).toEqual({ parseStatus: "not_applicable" });
  });
});

describe("parseStatementFile - bank OFX", () => {
  it("parses the statement into rows with the sign as the type and the amount unsigned", () => {
    const buffer = Buffer.from(BANK_OFX);
    const result = parseStatementFile(buffer, detectFile(buffer, "extrato.ofx"));

    expect(result.parseStatus).toBe("parsed");
    expect(result.rowCount).toBe(2);
    expect(result.parseError).toBeUndefined();
    expect(result.parsedPayload).toMatchObject({
      kind: "bank_ofx",
      bankName: "NU PAGAMENTOS",
      accountId: "43621320-1",
      currency: "BRL",
      // 2500.126 is rounded to the cent.
      ledgerBalance: 2500.13,
      balanceDate: "2026-01-31",
      dateStart: "2026-01-01",
      dateEnd: "2026-01-31",
    });
    const rows = (result.parsedPayload as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toEqual([
      expect.objectContaining({
        fitId: "fit-1",
        date: "2026-01-10",
        fullDescription: "Transferência enviada pelo Pix - JOAO - 123 - BANCO",
        amount: 1000.5,
        type: "expense",
      }),
      expect.objectContaining({
        fitId: "fit-2",
        date: "2026-01-11",
        fullDescription: "Transferência recebida pelo Pix - MARIA - 456 - BANCO",
        amount: 500,
        type: "income",
      }),
    ]);
    // The short description is a title, not the whole memo.
    expect(typeof rows[0]!.description).toBe("string");
    expect((rows[0]!.description as string).length).toBeGreaterThan(0);
  });

  it("falls back to BRL when the statement states no currency", () => {
    const buffer = Buffer.from(BANK_OFX.replace("<CURDEF>BRL\n", ""));
    const result = parseStatementFile(buffer, detectFile(buffer, "extrato.ofx"));
    expect(result.parseStatus).toBe("parsed");
    expect(result.parsedPayload).toMatchObject({ kind: "bank_ofx", currency: "BRL" });
  });

  it("keeps a statement without transactions as parsed with zero rows", () => {
    const empty = BANK_OFX.replace(/<STMTTRN>.*<\/STMTTRN>\n?/g, "");
    const buffer = Buffer.from(empty);
    const result = parseStatementFile(buffer, detectFile(buffer, "vazio.ofx"));
    expect(result).toMatchObject({ parseStatus: "parsed", rowCount: 0 });
    expect((result.parsedPayload as { rows: unknown[] }).rows).toEqual([]);
  });

  it("reports a failed parse, with the parser's message, for an OFX without a statement", () => {
    const buffer = Buffer.from("OFXHEADER:100\n<OFX></OFX>");
    const result = parseStatementFile(buffer, detectFile(buffer, "quebrado.ofx"));
    expect(result).toEqual({ parseStatus: "failed", parseError: "No STMTRS block found in OFX file" });
  });
});

describe("parseStatementFile - card OFX", () => {
  it("parses a card bill into card_csv rows: a charge is positive, a payment is flagged", () => {
    const buffer = Buffer.from(CARD_OFX);
    const detected = detectFile(buffer, "fatura.ofx");
    expect(detected.statementKind).toBe("card_ofx");

    const result = parseStatementFile(buffer, detected);

    expect(result.parseStatus).toBe("parsed");
    expect(result.rowCount).toBe(2);
    expect(result.parsedPayload).toEqual({
      kind: "card_csv",
      rows: [
        { date: "2026-01-10", description: "Mercado", amount: 120, installmentNumber: 2, totalInstallments: 3, isPayment: false },
        { date: "2026-01-12", description: "Pagamento recebido", amount: -500, installmentNumber: undefined, totalInstallments: undefined, isPayment: true },
      ],
    });
  });

  it("reports a failed parse for a card OFX without the statement block", () => {
    const buffer = Buffer.from("OFXHEADER:100\n<OFX><CCSTMTRS>");
    const result = parseStatementFile(buffer, detectFile(buffer, "fatura.ofx"));
    expect(result).toEqual({ parseStatus: "failed", parseError: "No CCSTMTRS block found in OFX file" });
  });
});

describe("parseStatementFile - CSV", () => {
  it("parses a card bill CSV into rows, with installments and the payment flag", () => {
    const csv = [
      "data,descricao,valor",
      "2026-09-01,Mercado,120.50",
      "2026-09-02,TV - Parcela 2/5,300.00",
      "2026-09-03,Pagamento recebido,-500.00",
    ].join("\n");
    const buffer = Buffer.from(csv);
    const detected = detectFile(buffer, "fatura.csv");
    expect(detected).toEqual({ fileType: "csv", statementKind: "card_csv" });

    const result = parseStatementFile(buffer, detected);

    expect(result.parseStatus).toBe("parsed");
    expect(result.rowCount).toBe(3);
    expect(result.parsedPayload).toEqual({
      kind: "card_csv",
      rows: [
        { date: "2026-09-01", description: "Mercado", amount: 120.5, installmentNumber: undefined, totalInstallments: undefined, isPayment: false },
        { date: "2026-09-02", description: "TV", amount: 300, installmentNumber: 2, totalInstallments: 5, isPayment: false },
        { date: "2026-09-03", description: "Pagamento recebido", amount: -500, installmentNumber: undefined, totalInstallments: undefined, isPayment: true },
      ],
    });
  });

  it("reports a failed parse for a CSV with only a header", () => {
    const buffer = Buffer.from("data,descricao,valor");
    const result = parseStatementFile(buffer, detectFile(buffer, "vazio.csv"));
    expect(result).toEqual({ parseStatus: "failed", parseError: "CSV must have at least a header and one data row" });
  });

  it("parses an unrecognized text file as CSV when it is handed over as one", () => {
    // upload-conversation-file refuses "unknown" before parsing; the parser itself still treats it as CSV.
    const buffer = Buffer.from("col1,col2,col3\n2026-09-01,Cafe,9.90\n");
    const result = parseStatementFile(buffer, detectFile(buffer, "notas.txt"));
    expect(result.parseStatus).toBe("parsed");
    expect(result.rowCount).toBe(1);
  });
});
