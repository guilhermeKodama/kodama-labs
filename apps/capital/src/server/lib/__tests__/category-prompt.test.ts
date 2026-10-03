import { describe, it, expect } from "vitest";
import {
  buildBillCategoryPrompt,
  coerceToAvailableCategory,
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
