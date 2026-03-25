import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseOfxContent, parseOfxDate } from "../parsers/ofx-parser";
import { detectStatementBank } from "../parsers/detect-bank";
import { extractShortTitle } from "../../utils";

// ---------------------------------------------------------------------------
// Real Nubank OFX files (3 months: Jan, Feb, Mar 2026)
// ---------------------------------------------------------------------------

const OFX_DIR = join(process.env.HOME!, "Downloads");
const JAN_FILE = join(OFX_DIR, "NU_43621320_01JAN2026_31JAN2026.ofx");
const FEB_FILE = join(OFX_DIR, "NU_43621320_01FEV2026_28FEV2026.ofx");
const MAR_FILE = join(OFX_DIR, "NU_43621320_01MAR2026_02MAR2026.ofx");

const HAS_LOCAL_OFX_FILES =
  existsSync(JAN_FILE) && existsSync(FEB_FILE) && existsSync(MAR_FILE);

function readOFX(path: string): string {
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// OFX Date Parsing
// ---------------------------------------------------------------------------

describe("parseOfxDate", () => {
  it("should parse YYYYMMDDHHMMSS[offset:TZ] format", () => {
    const date = parseOfxDate("20260303113735[0:GMT]");
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(2); // March = 2
    expect(date.getUTCDate()).toBe(3);
  });

  it("should parse YYYYMMDD format", () => {
    const date = parseOfxDate("20260115");
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(0); // January = 0
    expect(date.getUTCDate()).toBe(15);
  });

  it("should normalize to noon UTC", () => {
    const date = parseOfxDate("20260201");
    expect(date.getUTCHours()).toBe(12);
    expect(date.getUTCMinutes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bank Detection
// ---------------------------------------------------------------------------

describe("detectStatementBank", () => {
  it("should detect Nubank from ORG name", () => {
    const bank = detectStatementBank("NU PAGAMENTOS S.A.");
    expect(bank).toBeDefined();
    expect(bank!.name).toBe("Nubank");
  });

  it("should return undefined for unknown bank", () => {
    const bank = detectStatementBank("BANCO DO BRASIL");
    expect(bank).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OFX Parsing tests (require local OFX files in ~/Downloads)
// ---------------------------------------------------------------------------

if (HAS_LOCAL_OFX_FILES) {
  describe("parseOfxContent - January", () => {
    const parsed = parseOfxContent(readOFX(JAN_FILE));

    it("should detect Nubank as bank", () => {
      expect(parsed.bankName).toBe("NU PAGAMENTOS S.A.");
    });

    it("should extract account ID", () => {
      expect(parsed.account.accountId).toBe("4362132-0");
    });

    it("should extract BRL currency", () => {
      expect(parsed.currency).toBe("BRL");
    });

    it("should parse 35 transactions", () => {
      expect(parsed.transactions).toHaveLength(35);
    });

    it("should have unique FITIDs", () => {
      const fitIds = parsed.transactions.map((t) => t.fitId);
      expect(new Set(fitIds).size).toBe(35);
    });

    it("should have ledger balance of 797.28", () => {
      expect(parsed.ledgerBalance).toBe(797.28);
    });

    it("should have correct sum of credits", () => {
      const credits = parsed.transactions
        .filter((t) => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);
      expect(credits).toBeCloseTo(120255.02, 2);
    });

    it("should have correct sum of debits", () => {
      const debits = parsed.transactions
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + t.amount, 0);
      expect(debits).toBeCloseTo(-123839.51, 2);
    });

    it("should correctly parse first transaction (debit card purchase)", () => {
      const first = parsed.transactions[0];
      expect(first.trnType).toBe("DEBIT");
      expect(first.amount).toBe(-260.69);
      expect(first.memo).toContain("PADARIA IMIGRANTES");
      expect(first.date.getUTCFullYear()).toBe(2026);
      expect(first.date.getUTCMonth()).toBe(0);
      expect(first.date.getUTCDate()).toBe(1);
    });

    it("should correctly parse a large income (Pix received)", () => {
      const kodama = parsed.transactions.find((t) =>
        t.memo.includes("KODAMA DESENVOL") && t.amount > 20000
      );
      expect(kodama).toBeDefined();
      expect(kodama!.amount).toBe(29554.69);
    });

    it("should correctly parse credit card payment", () => {
      const ccPayment = parsed.transactions.find((t) =>
        t.memo.includes("Pagamento de fatura")
      );
      expect(ccPayment).toBeDefined();
      expect(ccPayment!.amount).toBe(-37417.96);
      expect(ccPayment!.trnType).toBe("DEBIT");
    });
  });

  describe("parseOfxContent - February", () => {
    const parsed = parseOfxContent(readOFX(FEB_FILE));

    it("should parse 36 transactions", () => {
      expect(parsed.transactions).toHaveLength(36);
    });

    it("should have ledger balance of 4372.26", () => {
      expect(parsed.ledgerBalance).toBe(4372.26);
    });

    it("should have correct sum of credits", () => {
      const credits = parsed.transactions
        .filter((t) => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);
      expect(credits).toBeCloseTo(101857.39, 2);
    });

    it("should have correct sum of debits", () => {
      const debits = parsed.transactions
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + t.amount, 0);
      expect(debits).toBeCloseTo(-98282.41, 2);
    });

    it("should verify: Jan ledger + Feb net = Feb ledger", () => {
      const janParsed = parseOfxContent(readOFX(JAN_FILE));
      const febNet = parsed.transactions.reduce((sum, t) => sum + t.amount, 0);
      expect(janParsed.ledgerBalance + febNet).toBeCloseTo(parsed.ledgerBalance, 2);
    });
  });

  describe("parseOfxContent - March", () => {
    const parsed = parseOfxContent(readOFX(MAR_FILE));

    it("should parse 1 transaction", () => {
      expect(parsed.transactions).toHaveLength(1);
    });

    it("should have ledger balance of 4022.26", () => {
      expect(parsed.ledgerBalance).toBe(4022.26);
    });

    it("should have a single -350 Pix transfer", () => {
      expect(parsed.transactions[0].amount).toBe(-350);
      expect(parsed.transactions[0].trnType).toBe("DEBIT");
    });

    it("should verify: Feb ledger + Mar net = Mar ledger", () => {
      const febParsed = parseOfxContent(readOFX(FEB_FILE));
      const marNet = parsed.transactions.reduce((sum, t) => sum + t.amount, 0);
      expect(febParsed.ledgerBalance + marNet).toBeCloseTo(parsed.ledgerBalance, 2);
    });
  });

  describe("Multi-file import balance", () => {
    const janParsed = parseOfxContent(readOFX(JAN_FILE));
    const febParsed = parseOfxContent(readOFX(FEB_FILE));
    const marParsed = parseOfxContent(readOFX(MAR_FILE));

    const allTransactions = [
      ...janParsed.transactions,
      ...febParsed.transactions,
      ...marParsed.transactions,
    ];

    const seenFitIds = new Set<string>();
    const uniqueTransactions = allTransactions.filter((t) => {
      if (seenFitIds.has(t.fitId)) return false;
      seenFitIds.add(t.fitId);
      return true;
    });

    it("should have 72 unique transactions across 3 files", () => {
      expect(uniqueTransactions).toHaveLength(72);
    });

    it("should have no FITID duplicates across files", () => {
      expect(seenFitIds.size).toBe(72);
    });

    it("should compute income as sum of positive amounts", () => {
      const income = uniqueTransactions
        .filter((t) => t.amount >= 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      expect(income).toBeCloseTo(222112.41, 2);
    });

    it("should compute expenses as sum of negative amounts", () => {
      const expenses = uniqueTransactions
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      expect(expenses).toBeCloseTo(222471.92, 2);
    });

    it("should compute net balance (income - expenses) as -359.51", () => {
      const income = uniqueTransactions
        .filter((t) => t.amount >= 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const expenses = uniqueTransactions
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      expect(income - expenses).toBeCloseTo(-359.51, 2);
    });

    it("should compute raw signed sum as -359.51", () => {
      const rawSum = uniqueTransactions.reduce((sum, t) => sum + t.amount, 0);
      expect(rawSum).toBeCloseTo(-359.51, 2);
    });

    it("should match: the final OFX ledger balance is 4022.26", () => {
      expect(marParsed.ledgerBalance).toBe(4022.26);
    });

    it("should derive starting balance before Jan from ledger", () => {
      const janNet = janParsed.transactions.reduce((s, t) => s + t.amount, 0);
      const startingBalance = janParsed.ledgerBalance - janNet;
      expect(startingBalance).toBeCloseTo(4381.77, 2);
    });

    it("should verify: starting balance + all transactions net = final ledger", () => {
      const janNet = janParsed.transactions.reduce((s, t) => s + t.amount, 0);
      const startingBalance = janParsed.ledgerBalance - janNet;
      const totalNet = uniqueTransactions.reduce((s, t) => s + t.amount, 0);
      expect(startingBalance + totalNet).toBeCloseTo(marParsed.ledgerBalance, 2);
    });
  });
}

// ---------------------------------------------------------------------------
// extractShortTitle
// ---------------------------------------------------------------------------

describe("extractShortTitle", () => {
  it("should shorten Pix sent", () => {
    expect(extractShortTitle(
      "Transferência enviada pelo Pix - Fabiano Barbosa - •••.853.628-•• - BCO SANTANDER (BRASIL) S.A. Agência: 3912 Conta: 1096867-0"
    )).toBe("Pix enviado - Fabiano Barbosa");
  });

  it("should shorten Pix received", () => {
    expect(extractShortTitle(
      "Transferência recebida pelo Pix - KODAMA SOFTWARE ENGI - 41.737.993/0001-66 - BANCO INTER (0077) Agência: 1 Conta: 12377153-6"
    )).toBe("Pix recebido - KODAMA SOFTWARE ENGI");
  });

  it("should shorten debit card purchase to merchant name", () => {
    expect(extractShortTitle(
      "Compra no débito - PADARIA IMIGRANTES"
    )).toBe("PADARIA IMIGRANTES");
  });

  it("should shorten boleto payment", () => {
    expect(extractShortTitle(
      "Pagamento de boleto efetuado - BANCO XP S/A"
    )).toBe("Boleto - BANCO XP S/A");
  });

  it("should shorten Pix via Open Banking", () => {
    expect(extractShortTitle(
      "Transferência enviada pelo Pix via Open Banking - Iniciada por: Bradesco ITP A2A - COMPANHIA PIRATININGA DE FORCA E LUZ - 04.172.213/0001-51 - BCO BRADESCO S.A."
    )).toBe("Pix enviado - COMPANHIA PIRATININGA DE FORCA E LUZ");
  });

  it("should pass through short memos unchanged", () => {
    expect(extractShortTitle("Aplicação RDB")).toBe("Aplicação RDB");
    expect(extractShortTitle("Resgate RDB")).toBe("Resgate RDB");
    expect(extractShortTitle("Pagamento de fatura")).toBe("Pagamento de fatura");
  });
});
