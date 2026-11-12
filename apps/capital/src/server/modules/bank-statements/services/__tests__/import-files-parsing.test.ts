import { describe, expect, it } from "vitest";
import {
  bankDisplayName,
  decodeImportContent,
  decodeImportFiles,
  detectImportKind,
  parseBankFiles,
  parseCardFiles,
  type DecodedImportFile,
  type ImportFileKind,
} from "../import-files";
import { BANK_OFX, CARD_CSV, CARD_OFX } from "./fixtures/import-files";

const file = (content: string, kind: ImportFileKind, name = "arquivo"): DecodedImportFile => {
  const buffer = Buffer.from(content, "utf8");
  return { name, size: buffer.byteLength, kind, buffer };
};

/** A bank OFX with only what the test needs. */
function bankOfx(opts: { org?: string; acct?: string; cur?: string; start?: string; end?: string; balance?: string; asOf?: string; trns?: string }) {
  const { org = "BANCO TESTE S.A.", acct = "123456-7", cur = "BRL", start = "20260901", end = "20260930", balance = "100.00", asOf = "20260930", trns = "" } = opts;
  return `OFXHEADER:100
<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>${org}</ORG></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>${cur}</CURDEF>
<BANKACCTFROM><BANKID>1</BANKID><ACCTID>${acct}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${start}</DTSTART>
<DTEND>${end}</DTEND>
${trns}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>${balance}</BALAMT><DTASOF>${asOf}</DTASOF></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
}

const trn = (date: string, amount: string, fitId: string, memo = "Compra") =>
  `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>${date}</DTPOSTED><TRNAMT>${amount}</TRNAMT><FITID>${fitId}</FITID><MEMO>${memo}</MEMO></STMTTRN>`;

describe("decodeImportContent", () => {
  it("decodes base64 wrapped across lines, and keeps short or non-base64 text as it is", () => {
    const wrapped = Buffer.from("OFXHEADER:100\n<OFX></OFX>").toString("base64").replace(/(.{8})/g, "$1\n");
    expect(decodeImportContent(wrapped).toString("utf8")).toBe("OFXHEADER:100\n<OFX></OFX>");
    expect(decodeImportContent("ABCD").toString("utf8")).toBe("ABCD");
    expect(decodeImportContent("date,title,amount").toString("utf8")).toBe("date,title,amount");
  });

  it("reads a data URL as base64 even without an explicit encoding, and an explicit 'text' wins over a data URL", () => {
    const url = `data:application/x-ofx;base64,${Buffer.from("abc").toString("base64")}`;
    expect(decodeImportContent(url).toString("utf8")).toBe("abc");
    expect(decodeImportContent(url, "text").toString("utf8")).toBe(url);
  });
});

describe("detectImportKind", () => {
  it("tells an image by its signature and a PDF by its header", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    expect(detectImportKind(png, "print.png")).toBe("image");
    expect(detectImportKind(Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(16)]), "x")).toBe("pdf");
  });

  it("takes any .csv by its name, and a nameless text only when it parses as a card bill", () => {
    expect(detectImportKind(Buffer.from("qualquer coisa"), "fatura.CSV")).toBe("card_csv");
    expect(detectImportKind(Buffer.from(CARD_CSV), "fatura")).toBe("card_csv");
    expect(detectImportKind(Buffer.from("só uma linha"), "notas")).toBeNull();
    expect(detectImportKind(Buffer.from("a\nb\nc"), "notas")).toBeNull();
  });
});

describe("decodeImportFiles", () => {
  it("names the nameless files by their position and reports each decoded size", () => {
    const decoded = decodeImportFiles([{ content: CARD_CSV }, { name: "  ", content: BANK_OFX }, { name: " extrato.ofx ", content: BANK_OFX }]);
    expect(decoded.map((d) => [d.name, d.kind, d.size])).toEqual([
      ["arquivo-1", "card_csv", Buffer.byteLength(CARD_CSV)],
      ["arquivo-2", "bank_ofx", Buffer.byteLength(BANK_OFX)],
      ["extrato.ofx", "bank_ofx", Buffer.byteLength(BANK_OFX)],
    ]);
  });

  it("answers a file that is nothing we read with import.invalid_file (400), naming the file", () => {
    expect(() => decodeImportFiles([{ name: "notas.txt", content: "só texto" }])).toThrow(
      expect.objectContaining({ status: 400, code: "import.invalid_file", message: "notas.txt is not a bank statement or card bill" })
    );
  });
});

describe("bankDisplayName", () => {
  it("strips the company suffix of banks it does not know, in its several spellings", () => {
    expect(bankDisplayName("BANCO INTER S.A.")).toBe("BANCO INTER");
    expect(bankDisplayName("Banco Foo S/A")).toBe("Banco Foo");
    expect(bankDisplayName("Foo Pagamentos LTDA.")).toBe("Foo Pagamentos");
    expect(bankDisplayName("Foo,  Bar  SA ,")).toBe("Foo, Bar");
  });

  it("returns null when nothing is left of the name", () => {
    expect(bankDisplayName("S.A.")).toBeNull();
    expect(bankDisplayName("   ")).toBeNull();
  });
});

describe("parseBankFiles", () => {
  it("merges the files of one account: the first bank and account, the latest balance, the widest period, each FITID once", () => {
    const march = bankOfx({
      acct: "111-1",
      cur: "USD",
      start: "20260301",
      end: "20260331",
      balance: "50.10",
      asOf: "20260331",
      trns: trn("20260310", "-10.00", "m1") + trn("20260320", "-5.00", "m2"),
    });
    const april = bankOfx({
      org: "OUTRO BANCO",
      acct: "222-2",
      cur: "USD",
      start: "20260401",
      end: "20260430",
      balance: "80.555",
      asOf: "20260430",
      trns: trn("20260410", "-3.00", "a1") + trn("20260320", "-5.00", "m2"),
    });
    // The later file first: the balance still comes from the latest date.
    const parsed = parseBankFiles([file(april, "bank_ofx"), file(march, "bank_ofx")]);
    expect(parsed).toMatchObject({
      bank: "OUTRO BANCO",
      externalAccountId: "222-2",
      currency: "USD",
      ledgerBalance: 80.56,
      period: { from: "2026-03-01", to: "2026-04-30" },
    });
    expect(parsed.transactions.map((t) => t.fitId).sort()).toEqual(["a1", "m1", "m2"]);
  });

  it("leaves out lines without FITID, with an unreadable amount or with no date, and widens the period to the lines' own dates", () => {
    const parsed = parseBankFiles([
      file(
        bankOfx({
          start: "20260905",
          end: "20260910",
          trns: [
            trn("20260901", "-1.00", "early"),
            trn("20260920", "-2.00", "late"),
            trn("20260906", "-3.00", ""),
            trn("20260906", "abc", "nan"),
            trn("", "-4.00", "nodate"),
          ].join("\n"),
        }),
        "bank_ofx"
      ),
    ]);
    expect(parsed.transactions.map((t) => t.fitId)).toEqual(["early", "late"]);
    expect(parsed.period).toEqual({ from: "2026-09-01", to: "2026-09-20" });
  });

  it("keeps BRL when the file names no currency, and no bank when it names no ORG", () => {
    const parsed = parseBankFiles([file(bankOfx({ org: "", cur: "", trns: trn("20260910", "-1.00", "x") }), "bank_ofx")]);
    expect(parsed).toMatchObject({ bank: null, currency: "BRL" });
  });

  it("answers an OFX with no statement block with import.invalid_file (400)", () => {
    expect(() => parseBankFiles([file("<OFX></OFX>", "bank_ofx")])).toThrow(expect.objectContaining({ status: 400, code: "import.invalid_file", message: "No STMTRS block found in OFX file" }));
  });

  it("answers a statement with no valid line with import.no_transactions (422)", () => {
    expect(() => parseBankFiles([file(bankOfx({ trns: trn("20260910", "abc", "x") }), "bank_ofx")])).toThrow(expect.objectContaining({ status: 422, code: "import.no_transactions" }));
  });
});

describe("parseCardFiles", () => {
  const cardOfx = (opts: { start?: string; end?: string; cur?: string; org?: string; acct?: string; lines?: string }) => `<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>${opts.org ?? "NU PAGAMENTOS S.A."}</ORG></FI></SONRS></SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CURDEF>${opts.cur ?? "BRL"}
<CCACCTFROM><ACCTID>${opts.acct ?? "5502********1234"}</CCACCTFROM>
<BANKTRANLIST>
${opts.start ? `<DTSTART>${opts.start}` : ""}
${opts.end ? `<DTEND>${opts.end}` : ""}
${opts.lines ?? "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260810120000<TRNAMT>-10.00<FITID>c1<MEMO>Cafe</STMTTRN>"}
</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

  it("states the cycle's range only when every file states one, widened over the files", () => {
    const a = cardOfx({ start: "20260806", end: "20260905" });
    const b = cardOfx({ start: "20260801", end: "20260930", lines: "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260815120000<TRNAMT>-5.00<FITID>c2<MEMO>Pao</STMTTRN>" });
    expect(parseCardFiles([file(a, "card_ofx"), file(b, "card_ofx")]).statedRange).toEqual({ from: "2026-08-01", to: "2026-09-30" });
    // A CSV among them (it states none), or an OFX without DTEND, leaves the coverage unknown.
    expect(parseCardFiles([file(a, "card_ofx"), file(CARD_CSV, "card_csv")]).statedRange).toBeNull();
    expect(parseCardFiles([file(cardOfx({ start: "20260806" }), "card_ofx")]).statedRange).toBeNull();
  });

  it("takes the bank, card number and currency from the first file that has them, and the period from the non-installment purchases", () => {
    const parsed = parseCardFiles([file(CARD_CSV, "card_csv"), file(cardOfx({ org: "BANCO FOO S.A.", acct: "9999", cur: "USD" }), "card_ofx")]);
    expect(parsed).toMatchObject({ bank: "Nubank", externalAccountId: "9999", currency: "USD", payments: 1 });
    expect(parsed.period).toEqual({ from: "2026-08-10", to: "2026-09-01" });
    expect(parsed.rows.map((r) => r.description)).toEqual(["Netflix.com", "Mercado Livre", "Padaria Real", "Cafe"]);
  });

  it("recognises the XP and generic CSV headers, and reads the period of a bill made only of installments from them", () => {
    const xp = parseCardFiles([file("Data;Estabelecimento;Portador;Valor;Parcela\n02/04/2026;LOJA;MR;R$ 49,92;11 de 12\n", "card_csv")]);
    expect(xp.bank).toBe("XP");
    expect(xp.rows).toEqual([{ date: "2026-04-02", description: "LOJA", amount: 49.92, installment: { number: 11, total: 12 } }]);
    expect(xp.period).toEqual({ from: "2026-04-02", to: "2026-04-02" });
    expect(parseCardFiles([file("x,y,z\n2026-09-01,Cafe,5.00\n", "card_csv")]).bank).toBeNull();
  });

  it("answers an unreadable file, a row with a date it cannot read and a bill without rows with the import errors", () => {
    expect(() => parseCardFiles([file("só uma linha", "card_csv")])).toThrow(expect.objectContaining({ status: 400, code: "import.invalid_file" }));
    expect(() => parseCardFiles([file("<OFX></OFX>", "card_ofx")])).toThrow(expect.objectContaining({ status: 400, code: "import.invalid_file", message: "No CCSTMTRS block found in OFX file" }));
    expect(() => parseCardFiles([file("date,title,amount\nontem,Cafe,5.00\n", "card_csv")])).toThrow(expect.objectContaining({ status: 400, code: "import.invalid_file", message: "Invalid date format: ontem" }));
    expect(() => parseCardFiles([file("date,title,amount\n2026-09-01,Pagamento recebido,-5.00\n", "card_csv")])).toThrow(expect.objectContaining({ status: 422, code: "import.no_transactions" }));
  });

  it("reads the FITID and the installments of an OFX card line", () => {
    const parsed = parseCardFiles([file(CARD_OFX, "card_ofx")]);
    expect(parsed.rows.find((r) => r.installment)).toMatchObject({ description: "Loja Eletronicos", installment: { number: 2, total: 6 }, externalId: "cc4" });
    expect(parsed.rows.find((r) => r.description === "Uber *Trip")).toMatchObject({ externalId: "cc1" });
  });
});
