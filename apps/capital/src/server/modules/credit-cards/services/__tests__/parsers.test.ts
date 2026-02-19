import { describe, it, expect } from "vitest";
import { parseCsvContent, detectBankParser } from "../parsers";
import { parseCsvLine, parseAmount } from "../parsers/utils";
import { nubankParser } from "../parsers/nubank";
import { xpParser } from "../parsers/xp";

// ---------------------------------------------------------------------------
// XP CSV sample – based on a real XP credit card bill export
// ---------------------------------------------------------------------------
const XP_CSV = `Data;Estabelecimento;Portador;Valor;Parcela
02/04/2025;PG *GUILHERME FRE;MR KODAMA;R$ 49,92;11 de 12
08/08/2025;SPORT LIFE VINHEDO;MR KODAMA;R$ 680,00;7 de 12
11/08/2025;MERCADOPAGO*2PRODUTOS;MR KODAMA;R$ 66,00;7 de 10
12/04/2025;BROOKSFIELD BFCP FL 28;MR KODAMA;R$ 1.215,96;10 de 10
20/01/2026;Pagamentos Validos Normais;MR KODAMA;R$ -3.544,67;-`;

// ---------------------------------------------------------------------------
// detectBankParser
// ---------------------------------------------------------------------------
describe("detectBankParser", () => {
  it("should detect Nubank from headers", () => {
    const parser = detectBankParser(["date", "title", "amount"]);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe("Nubank");
  });

  it("should detect XP from headers", () => {
    const parser = detectBankParser(["data", "estabelecimento", "portador", "valor", "parcela"]);
    expect(parser).toBeDefined();
    expect(parser!.name).toBe("XP");
  });

  it("should return undefined for unknown headers", () => {
    const parser = detectBankParser(["col1", "col2", "col3"]);
    expect(parser).toBeUndefined();
  });

  it("should not confuse a generic CSV with XP (needs parcela column)", () => {
    // Has "data" + "estabelecimento" + "valor" but NOT "parcela" → not XP
    const parser = detectBankParser(["data", "estabelecimento", "valor"]);
    expect(parser?.name).not.toBe("XP");
  });
});

// ---------------------------------------------------------------------------
// XP parser config
// ---------------------------------------------------------------------------
describe("xpParser", () => {
  describe("detect", () => {
    it("should match XP headers", () => {
      expect(
        xpParser.detect(["data", "estabelecimento", "portador", "valor", "parcela"])
      ).toBe(true);
    });

    it("should not match Nubank headers", () => {
      expect(xpParser.detect(["date", "title", "amount"])).toBe(false);
    });
  });

  describe("parseInstallmentFromColumn", () => {
    it("should parse 'X de Y' format", () => {
      const result = xpParser.parseInstallmentFromColumn!("11 de 12");
      expect(result.installmentNumber).toBe(11);
      expect(result.totalInstallments).toBe(12);
    });

    it("should parse '7 de 10' format", () => {
      const result = xpParser.parseInstallmentFromColumn!("7 de 10");
      expect(result.installmentNumber).toBe(7);
      expect(result.totalInstallments).toBe(10);
    });

    it("should return empty for '-'", () => {
      const result = xpParser.parseInstallmentFromColumn!("-");
      expect(result.installmentNumber).toBeUndefined();
      expect(result.totalInstallments).toBeUndefined();
    });

    it("should return empty for empty string", () => {
      const result = xpParser.parseInstallmentFromColumn!("");
      expect(result.installmentNumber).toBeUndefined();
      expect(result.totalInstallments).toBeUndefined();
    });

    it("should handle X/Y format as fallback", () => {
      const result = xpParser.parseInstallmentFromColumn!("3/12");
      expect(result.installmentNumber).toBe(3);
      expect(result.totalInstallments).toBe(12);
    });
  });
});

// ---------------------------------------------------------------------------
// Nubank parser config
// ---------------------------------------------------------------------------
describe("nubankParser", () => {
  describe("detect", () => {
    it("should match Nubank headers", () => {
      expect(nubankParser.detect(["date", "title", "amount"])).toBe(true);
    });

    it("should not match XP headers", () => {
      expect(
        nubankParser.detect(["data", "estabelecimento", "portador", "valor", "parcela"])
      ).toBe(false);
    });
  });

  describe("parseInstallmentFromDescription", () => {
    it("should parse 'STORE - Parcela 1/10'", () => {
      const info = nubankParser.parseInstallmentFromDescription(
        "Nve*Rentcarsltda - Parcela 1/3"
      );
      expect(info.installmentNumber).toBe(1);
      expect(info.totalInstallments).toBe(3);
      expect(info.cleanDescription).toBe("Nve*Rentcarsltda");
    });

    it("should parse generic '(3/12)' format", () => {
      const info = nubankParser.parseInstallmentFromDescription(
        "Some Store (3/12)"
      );
      expect(info.installmentNumber).toBe(3);
      expect(info.totalInstallments).toBe(12);
      expect(info.cleanDescription).toBe("Some Store");
    });

    it("should return description unchanged when no installment", () => {
      const info = nubankParser.parseInstallmentFromDescription(
        "Applecombill"
      );
      expect(info.installmentNumber).toBeUndefined();
      expect(info.totalInstallments).toBeUndefined();
      expect(info.cleanDescription).toBe("Applecombill");
    });
  });
});

// ---------------------------------------------------------------------------
// parseCsvContent — XP format
// ---------------------------------------------------------------------------
describe("parseCsvContent (XP format)", () => {
  it("should parse all 5 data rows from the XP CSV", () => {
    const transactions = parseCsvContent(XP_CSV);
    expect(transactions).toHaveLength(5);
  });

  it("should correctly parse XP descriptions", () => {
    const transactions = parseCsvContent(XP_CSV);
    expect(transactions[0].description).toBe("PG *GUILHERME FRE");
    expect(transactions[1].description).toBe("SPORT LIFE VINHEDO");
    expect(transactions[3].description).toBe("BROOKSFIELD BFCP FL 28");
  });

  it("should parse XP dates in DD/MM/YYYY format", () => {
    const transactions = parseCsvContent(XP_CSV);
    expect(transactions[0].date).toBe("02/04/2025");
    expect(transactions[4].date).toBe("20/01/2026");
  });

  it("should parse XP amounts with R$ currency and Brazilian number format", () => {
    const transactions = parseCsvContent(XP_CSV);
    expect(transactions[0].amount).toBe(49.92);
    expect(transactions[1].amount).toBe(680.0);
    expect(transactions[3].amount).toBe(1215.96);
  });

  it("should parse installments from the 'Parcela' column", () => {
    const transactions = parseCsvContent(XP_CSV);
    // "11 de 12"
    expect(transactions[0].installmentNumber).toBe(11);
    expect(transactions[0].totalInstallments).toBe(12);
    // "7 de 12"
    expect(transactions[1].installmentNumber).toBe(7);
    expect(transactions[1].totalInstallments).toBe(12);
    // "7 de 10"
    expect(transactions[2].installmentNumber).toBe(7);
    expect(transactions[2].totalInstallments).toBe(10);
    // "10 de 10"
    expect(transactions[3].installmentNumber).toBe(10);
    expect(transactions[3].totalInstallments).toBe(10);
  });

  it("should have no installment info for payment lines (parcela = '-')", () => {
    const transactions = parseCsvContent(XP_CSV);
    const payment = transactions.find((t) => t.isPayment);
    expect(payment).toBeDefined();
    expect(payment!.installmentNumber).toBeUndefined();
    expect(payment!.totalInstallments).toBeUndefined();
  });

  it("should detect 'Pagamentos Validos Normais' as a payment line", () => {
    const transactions = parseCsvContent(XP_CSV);
    const payments = transactions.filter((t) => t.isPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].description).toBe("Pagamentos Validos Normais");
    expect(payments[0].amount).toBe(-3544.67);
  });

  it("should correctly parse negative amounts in Brazilian format", () => {
    const transactions = parseCsvContent(XP_CSV);
    const payment = transactions.find((t) => t.isPayment);
    expect(payment!.amount).toBe(-3544.67);
  });
});

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------
describe("parseCsvLine", () => {
  it("should parse semicolon-separated line", () => {
    const result = parseCsvLine("a;b;c", ";");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("should parse comma-separated line", () => {
    const result = parseCsvLine("a,b,c", ",");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("should handle quoted fields with semicolons inside", () => {
    const result = parseCsvLine('"a;b";c;d', ";");
    expect(result).toEqual(["a;b", "c", "d"]);
  });

  it("should handle escaped double-quotes", () => {
    const result = parseCsvLine('"Estorno de ""Store""",-100.00', ",");
    expect(result).toEqual(['Estorno de "Store"', "-100.00"]);
  });
});

describe("parseAmount", () => {
  it("should parse standard decimal", () => {
    expect(parseAmount("100.50")).toBe(100.5);
  });

  it("should parse Brazilian format with comma", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
  });

  it("should parse R$ currency prefix", () => {
    expect(parseAmount("R$ 49,92")).toBe(49.92);
  });

  it("should parse negative R$ amounts", () => {
    expect(parseAmount("R$ -3.544,67")).toBe(-3544.67);
  });

  it("should parse simple comma-only format", () => {
    expect(parseAmount("680,00")).toBe(680.0);
  });
});
