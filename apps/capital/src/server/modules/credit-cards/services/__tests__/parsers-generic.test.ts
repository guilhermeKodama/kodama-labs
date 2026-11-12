import { describe, expect, it } from "vitest";
import { buildFallbackParser } from "../parsers/detect-bank";
import { parseCsvContent } from "../parsers";
import { computeCycleStart, parseAmount, parseCsvLine, parseDate } from "../parsers/utils";
import { xpParser } from "../parsers/xp";

describe("buildFallbackParser (banks with no dedicated parser)", () => {
  const parser = buildFallbackParser(["data", "descricao", "valor"]);

  it("claims any headers and maps the broad Portuguese and English column names", () => {
    expect(parser.name).toBe("Generic");
    expect(parser.detect([])).toBe(true);
    expect(parser.dateHeaders).toEqual(expect.arrayContaining(["date", "data", "data da compra"]));
    expect(parser.descriptionHeaders).toEqual(expect.arrayContaining(["description", "descrição", "estabelecimento"]));
    expect(parser.amountHeaders).toEqual(expect.arrayContaining(["amount", "valor", "quantia"]));
    expect(parser.installmentColumn).toBeUndefined();
  });

  it("reads 'Parcela X/Y' and '(X/Y)' suffixes off the description", () => {
    expect(parser.parseInstallmentFromDescription("Loja X - Parcela 3/10")).toEqual({ installmentNumber: 3, totalInstallments: 10, cleanDescription: "Loja X" });
    expect(parser.parseInstallmentFromDescription("Loja Y (2/6)")).toEqual({ installmentNumber: 2, totalInstallments: 6, cleanDescription: "Loja Y" });
    expect(parser.parseInstallmentFromDescription("Loja Z 4/4")).toEqual({ installmentNumber: 4, totalInstallments: 4, cleanDescription: "Loja Z" });
  });

  it("ignores suffixes that are no installment (1 of 1, number past the total, zero) and keeps the description", () => {
    expect(parser.parseInstallmentFromDescription("Loja - Parcela 1/1")).toEqual({ cleanDescription: "Loja - Parcela 1/1" });
    expect(parser.parseInstallmentFromDescription("Loja - Parcela 5/3")).toEqual({ cleanDescription: "Loja - Parcela 5/3" });
    expect(parser.parseInstallmentFromDescription("Loja (7/3)")).toEqual({ cleanDescription: "Loja (7/3)" });
    expect(parser.parseInstallmentFromDescription("Loja 0/12")).toEqual({ cleanDescription: "Loja 0/12" });
    expect(parser.parseInstallmentFromDescription("Padaria")).toEqual({ cleanDescription: "Padaria" });
  });

  it("lists the lowercase payment keywords of the supported banks", () => {
    expect(parser.paymentKeywords).toEqual(expect.arrayContaining(["pagamento recebido", "pagamentos validos normais"]));
  });
});

describe("parseCsvContent with a bank that has no parser", () => {
  it("falls back to the generic parser: Portuguese headers, comma separator, installments and payment lines", () => {
    const csv = ["data,descricao,valor", "2026-09-01,Mercado,120.50", "2026-09-02,TV - Parcela 2/5,300.00", "2026-09-03,Pagamento recebido,-500.00", "2026-09-04,Estorno loja,-10.00"].join("\n");
    expect(parseCsvContent(csv)).toEqual([
      { date: "2026-09-01", description: "Mercado", amount: 120.5, installmentNumber: undefined, totalInstallments: undefined, isPayment: false },
      { date: "2026-09-02", description: "TV", amount: 300, installmentNumber: 2, totalInstallments: 5, isPayment: false },
      { date: "2026-09-03", description: "Pagamento recebido", amount: -500, installmentNumber: undefined, totalInstallments: undefined, isPayment: true },
      { date: "2026-09-04", description: "Estorno loja", amount: -10, installmentNumber: undefined, totalInstallments: undefined, isPayment: false },
    ]);
  });

  it("reads a semicolon file with Brazilian amounts", () => {
    const csv = "Data;Descrição;Valor\n03/09/2026;Padaria;R$ 1.234,56\n";
    const [row] = parseCsvContent(csv);
    expect(row).toMatchObject({ date: "03/09/2026", description: "Padaria", amount: 1234.56, isPayment: false });
  });

  it("reads the first three columns (date, description, amount) when the headers are unknown", () => {
    const csv = "col1,col2,col3\n2026-09-01,Cafe,9.90\n";
    expect(parseCsvContent(csv)).toEqual([{ date: "2026-09-01", description: "Cafe", amount: 9.9, installmentNumber: undefined, totalInstallments: undefined, isPayment: false }]);
  });

  it("skips blank lines, short rows and rows whose amount is not a number", () => {
    const csv = ["date,title,amount", "2026-09-01,Cafe,9.90", "", "   ", "2026-09-02,Sem valor", "2026-09-03,Quebrado,abc", "2026-09-04,Pao,3.50"].join("\n");
    expect(parseCsvContent(csv).map((t) => t.description)).toEqual(["Cafe", "Pao"]);
  });

  it("refuses a file with no data row", () => {
    expect(() => parseCsvContent("date,title,amount")).toThrow("CSV must have at least a header and one data row");
    expect(() => parseCsvContent("")).toThrow("CSV must have at least a header and one data row");
  });
});

describe("XP parser without its installment column data", () => {
  it("keeps the description as it is (installments come from the Parcela column)", () => {
    expect(xpParser.parseInstallmentFromDescription("PG *LOJA 3/12")).toEqual({ cleanDescription: "PG *LOJA 3/12" });
  });

  it("returns no installment for a column value in neither format, or with the number past the total", () => {
    expect(xpParser.parseInstallmentFromColumn!("abc")).toEqual({});
    expect(xpParser.parseInstallmentFromColumn!("13 de 12")).toEqual({});
    expect(xpParser.parseInstallmentFromColumn!("1 de 1")).toEqual({});
    expect(xpParser.parseInstallmentFromColumn!("5/3")).toEqual({});
    expect(xpParser.parseInstallmentFromColumn!(" 4 de 6 ")).toEqual({ installmentNumber: 4, totalInstallments: 6 });
  });
});

describe("parseCsvLine", () => {
  it("keeps the text of a quote left open until the end of the line", () => {
    expect(parseCsvLine('a,"b,c', ",")).toEqual(["a", "b,c"]);
  });

  it("trims the fields and keeps empty ones", () => {
    expect(parseCsvLine(" a ; ;c ", ";")).toEqual(["a", "", "c"]);
  });
});

describe("parseAmount", () => {
  it("reads US thousands separators and a plain integer", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("-2,000.50")).toBe(-2000.5);
    expect(parseAmount("42")).toBe(42);
  });

  it("strips the currency symbols and quotes", () => {
    expect(parseAmount('"R$ 10,50"')).toBe(10.5);
    expect(parseAmount("$99.90")).toBe(99.9);
  });

  it("returns NaN for text that is no number", () => {
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("parseDate", () => {
  const iso = (d: Date) => d.toISOString();

  it("reads ISO and Brazilian dates at noon UTC (no timezone shift)", () => {
    expect(iso(parseDate("2026-09-05"))).toBe("2026-09-05T12:00:00.000Z");
    expect(iso(parseDate('"2026-09-05"'))).toBe("2026-09-05T12:00:00.000Z");
    expect(iso(parseDate("5/9/2026"))).toBe("2026-09-05T12:00:00.000Z");
    expect(iso(parseDate("05/09/2026"))).toBe("2026-09-05T12:00:00.000Z");
  });

  it("hands any other format to the JS Date parser", () => {
    expect(iso(parseDate("2026-09-05T10:30:00Z"))).toBe("2026-09-05T10:30:00.000Z");
  });

  it("throws on a string that is no date", () => {
    expect(() => parseDate("ontem")).toThrow("Invalid date format: ontem");
  });
});

describe("computeCycleStart", () => {
  const day = (d: Date) => d.toISOString().slice(0, 10);

  it("starts the day after the previous month's closing", () => {
    expect(day(computeCycleStart(new Date("2026-09-05T12:00:00Z")))).toBe("2026-08-06");
  });

  it("wraps January into December of the year before", () => {
    expect(day(computeCycleStart(new Date("2026-01-10T12:00:00Z")))).toBe("2025-12-11");
  });

  it("clamps a closing day the previous month does not have", () => {
    expect(day(computeCycleStart(new Date("2026-03-31T12:00:00Z")))).toBe("2026-03-01");
    expect(day(computeCycleStart(new Date("2026-05-31T12:00:00Z")))).toBe("2026-05-01");
  });
});
