import { describe, expect, it } from "vitest";
import { ImportPlanPayloadSchema, hashPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { paymentStatementMonth } from "../card-payments";
import { accountNumberMatches, bankDisplayName, decodeImportContent, decodeImportFiles, lastDigits, parseBankFiles, parseCardFiles } from "../import-files";
import { BANK_OFX, CARD_CSV, CARD_OFX } from "./fixtures/import-files";

describe("decodeImportContent", () => {
  it("reads plain text, base64 and base64 data URLs", () => {
    expect(decodeImportContent(CARD_CSV).toString("utf8")).toBe(CARD_CSV);
    expect(decodeImportContent(Buffer.from(BANK_OFX).toString("base64")).toString("utf8")).toBe(BANK_OFX);
    expect(decodeImportContent(`data:text/csv;base64,${Buffer.from(CARD_CSV).toString("base64")}`).toString("utf8")).toBe(CARD_CSV);
  });

  it("honours an explicit encoding", () => {
    expect(decodeImportContent("QUJDRA==", "text").toString("utf8")).toBe("QUJDRA==");
    expect(decodeImportContent("QUJDRA==", "base64").toString("utf8")).toBe("ABCD");
  });
});

describe("decodeImportFiles", () => {
  it("detects each file's kind from its content", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16)]).toString("base64");
    const kinds = decodeImportFiles([
      { name: "extrato.ofx", content: BANK_OFX },
      { name: "fatura.ofx", content: CARD_OFX },
      { name: "fatura.csv", content: CARD_CSV },
      { name: "sem-extensao", content: CARD_CSV },
      { name: "nota.pdf", content: pdf },
    ]).map((f) => f.kind);
    expect(kinds).toEqual(["bank_ofx", "card_ofx", "card_csv", "card_csv", "pdf"]);
  });

  it("rejects what is no statement with import.invalid_file", () => {
    expect(() => decodeImportFiles([{ name: "notas.txt", content: "just some notes" }])).toThrow(expect.objectContaining({ code: "import.invalid_file" }));
  });
});

describe("parsing", () => {
  it("merges bank OFX files by FITID and reads bank, account, period and balance", () => {
    const files = decodeImportFiles([{ name: "a.ofx", content: BANK_OFX }, { name: "b.ofx", content: BANK_OFX }]);
    const parsed = parseBankFiles(files);
    expect(parsed).toMatchObject({ bank: "Nubank", externalAccountId: "98765-4", currency: "BRL", ledgerBalance: 3157.8, period: { from: "2026-09-01", to: "2026-09-15" } });
    expect(parsed.transactions).toHaveLength(6);
  });

  it("reads card bills without their payment lines, and the cycle from the non-installment purchases", () => {
    const ofx = parseCardFiles(decodeImportFiles([{ name: "f.ofx", content: CARD_OFX }]));
    expect(ofx).toMatchObject({ bank: "Nubank", externalAccountId: "5502********1234", payments: 1, period: { from: "2026-08-10", to: "2026-09-02" } });
    expect(ofx.rows.map((r) => [r.date, r.description, r.amount, r.installment?.number ?? null])).toEqual([
      ["2026-08-10", "Uber *Trip", 45.9, null],
      ["2026-08-20", "Estorno Amazon", -20, null],
      ["2026-07-12", "Loja Eletronicos", 199, 2],
      ["2026-09-02", "DROGASIL 1234", 64.3, null],
    ]);
    const csv = parseCardFiles(decodeImportFiles([{ name: "f.csv", content: CARD_CSV }]));
    expect(csv).toMatchObject({ bank: "Nubank", externalAccountId: null, payments: 1, period: { from: "2026-08-20", to: "2026-09-01" } });
    expect(csv.rows).toHaveLength(3);
  });
});

describe("account matching", () => {
  it("compares account numbers by their letters and digits, the shorter ending the longer", () => {
    expect(accountNumberMatches("98765-4", "987654")).toBe(true);
    expect(accountNumberMatches("47404983-7", "0001 / 47404983-7")).toBe(true);
    expect(accountNumberMatches("47404983-7", "3-7")).toBe(false);
    expect(accountNumberMatches("47404983-7", null)).toBe(false);
  });

  it("takes a card's last four digits", () => {
    expect(lastDigits("5502********1234")).toBe("1234");
    expect(lastDigits("12")).toBeNull();
  });

  it("names known banks and strips the company suffix of others", () => {
    expect(bankDisplayName("NU PAGAMENTOS S.A.")).toBe("Nubank");
    expect(bankDisplayName("BANCO INTER S.A.")).toBe("BANCO INTER");
  });
});

describe("paymentStatementMonth", () => {
  const at = (d: string) => new Date(`${d}T12:00:00Z`);

  it("picks the statement due nearest the payment", () => {
    const card = { closingDay: 5, dueDay: 12 };
    expect(paymentStatementMonth(card, at("2026-09-12"))).toBe("2026-09");
    expect(paymentStatementMonth(card, at("2026-09-08"))).toBe("2026-09");
    expect(paymentStatementMonth(card, at("2026-09-30"))).toBe("2026-10");
  });

  it("handles a due date in the month after the closing", () => {
    expect(paymentStatementMonth({ closingDay: 28, dueDay: 5 }, at("2026-10-04"))).toBe("2026-09");
  });

  it("without a due day, takes the latest statement closed by then", () => {
    expect(paymentStatementMonth({ closingDay: 5, dueDay: null }, at("2026-09-20"))).toBe("2026-09");
    expect(paymentStatementMonth({ closingDay: 5, dueDay: null }, at("2026-09-03"))).toBe("2026-08");
  });
});

describe("ImportPlanPayloadSchema extension", () => {
  const stored = {
    entityType: "personal",
    entityId: "pf_1",
    currency: "BRL",
    transactions: [{ externalId: "a", date: "2026-09-01", description: "x", amount: 10, type: "expense", category: "Mercado" }],
  };

  it("parses a plan stored before the extension to the same object, so its hash holds", () => {
    const parsed = ImportPlanPayloadSchema.parse(stored);
    expect(Object.keys(parsed)).not.toEqual(expect.arrayContaining(["accountId"]));
    expect(parsed).not.toHaveProperty("cardPayments");
    expect(parsed).not.toHaveProperty("cardStatement");
    expect(Object.keys(parsed.transactions[0]).sort()).toEqual(["amount", "category", "date", "description", "externalId", "type"]);
    expect(hashPlanPayload(ImportPlanPayloadSchema.parse(JSON.parse(JSON.stringify(parsed))))).toBe(hashPlanPayload(parsed));
  });

  it("accepts the dialog's fields and checks them", () => {
    const plan = ImportPlanPayloadSchema.parse({
      ...stored,
      accountId: "acc_1",
      transactions: [{ ...stored.transactions[0], categoryId: "cat_1", createRule: true }],
      cardPayments: [{ externalId: "b", date: "2026-09-12", amount: 1500, cardAccountId: "card_1", statementMonth: "2026-09" }],
      cardStatement: { month: "2026-09", rows: [{ date: "2026-08-10", description: "Uber", amount: 45.9, allowDuplicate: true }], linkPayment: true },
    });
    expect(plan.cardStatement?.rows[0].allowDuplicate).toBe(true);
    expect(() => ImportPlanPayloadSchema.parse({ ...stored, cardPayments: [{ externalId: "b", date: "12/09/2026", amount: 1, cardAccountId: "c" }] })).toThrow();
    expect(() => ImportPlanPayloadSchema.parse({ ...stored, cardStatement: { month: "2026-09", rows: [{ date: "2026-08-10", description: "x", amount: 0 }] } })).toThrow();
  });
});
