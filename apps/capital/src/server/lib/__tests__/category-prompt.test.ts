import { describe, it, expect } from "vitest";
import {
  BILL_LABEL_KEYS,
  STATEMENT_LABEL_KEYS,
  buildBillCategoryPrompt,
  buildStatementCategoryPrompt,
  coerceToAvailableCategory,
  label,
} from "../category-prompt";

const labels: Record<string, string> = {
  subscriptions: "Assinaturas",
  groceries: "Mercado",
  restaurants_dining: "Restaurantes",
  transportation: "Transporte",
  shopping: "Compras",
  entertainment: "Lazer",
  health_pharmacy: "Saúde",
  travel_system: "Viagem",
  education: "Educação",
  personal_care: "Cuidados",
  home: "Casa",
  software_tools: "Software",
  fees_charges: "Taxas",
  utilities: "Contas",
  other_system: "Outros",
};

describe("category prompt helpers", () => {
  it("replaces an unknown model answer with the user's fallback name", () => {
    expect(coerceToAvailableCategory("Other", ["Mercado", "Outros"], "Outros")).toBe("Outros");
    expect(coerceToAvailableCategory("Mercado", ["Mercado", "Outros"], "Outros")).toBe("Mercado");
  });

  it("builds bill rules from the user's category names", () => {
    const prompt = buildBillCategoryPrompt('0. "Padaria"', ["Mercado", "Outros"], labels);
    expect(prompt).toContain('Use "Mercado" for supermarkets');
    expect(prompt).toContain('Use "Outros" only if absolutely no other category fits');
    expect(prompt).not.toContain('Use "Groceries"');
    expect(prompt).not.toContain('Use "Other"');
  });
});

const statementLabels: Record<string, string> = {
  credit_card: "Cartão de Crédito",
  other_system: "Outros",
  other_income: "Outras Receitas",
};

describe("label", () => {
  it("returns the user's name for a system key", () => {
    expect(label(labels, "groceries")).toBe("Mercado");
  });

  it("throws, naming the key, when the user has no label for it", () => {
    expect(() => label(labels, "other_income")).toThrow("Missing category label for system key other_income");
    expect(() => label({ groceries: "" }, "groceries")).toThrow(/Missing category label/);
  });
});

describe("label keys", () => {
  it("cover every key the prompts read", () => {
    for (const key of BILL_LABEL_KEYS) expect(label(labels, key)).toBeTruthy();
    for (const key of STATEMENT_LABEL_KEYS) expect(label(statementLabels, key)).toBeTruthy();
  });
});

describe("buildBillCategoryPrompt", () => {
  it("lists the available categories and the transactions to categorize", () => {
    const prompt = buildBillCategoryPrompt('0. "Netflix"\n1. "Zaffari"', ["Mercado", "Assinaturas", "Outros"], labels);
    expect(prompt).toContain("- Mercado\n- Assinaturas\n- Outros");
    expect(prompt).toContain('0. "Netflix"\n1. "Zaffari"');
    expect(prompt).toContain('Use "Assinaturas" for recurring digital services');
    expect(prompt).toContain('Use "Viagem" for hotels');
    expect(prompt).toContain('provide a suggestedCategory');
  });

  it("fails when a label the rules need is missing", () => {
    const { other_system: _omitted, ...withoutOther } = labels;
    void _omitted;
    expect(() => buildBillCategoryPrompt("0. x", ["Mercado"], withoutOther)).toThrow("Missing category label for system key other_system");
  });
});

describe("buildStatementCategoryPrompt", () => {
  it("frames an expense statement with the Other expense fallback", () => {
    const prompt = buildStatementCategoryPrompt('0. "Pix - Padaria"', ["Mercado", "Outros"], statementLabels, "expense");
    expect(prompt).toContain("(expense/debit)");
    expect(prompt).toContain('Use "Outros" only if absolutely no other category fits');
    expect(prompt).toContain('"Pagamento de fatura" should be "Cartão de Crédito"');
    expect(prompt).toContain('{"index": 0, "category": "Mercado"}, {"index": 1, "category": "Outros"}');
    expect(prompt).not.toContain("Outras Receitas");
  });

  it("frames an income statement with the Other income fallback", () => {
    const prompt = buildStatementCategoryPrompt('0. "Pix recebido"', ["Salário", "Outras Receitas"], statementLabels, "income");
    expect(prompt).toContain("(income/credit)");
    expect(prompt).toContain('Use "Outras Receitas" only if absolutely no other category fits');
    expect(prompt).toContain('{"index": 0, "category": "Salário"}, {"index": 1, "category": "Outras Receitas"}');
  });

  it("falls back to the fallback name in the example when there are no categories", () => {
    const prompt = buildStatementCategoryPrompt("0. x", [], statementLabels, "expense");
    expect(prompt).toContain('{"index": 0, "category": "Outros"}, {"index": 1, "category": "Outros"}');
  });

  it("fails when the label for the type's fallback is missing", () => {
    const { other_income: _omitted, ...withoutIncome } = statementLabels;
    void _omitted;
    expect(() => buildStatementCategoryPrompt("0. x", ["A"], withoutIncome, "income")).toThrow("Missing category label for system key other_income");
    expect(() => buildStatementCategoryPrompt("0. x", ["A"], withoutIncome, "expense")).not.toThrow();
  });
});
