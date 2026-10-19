import { describe, expect, it } from "vitest";
import { classifyByRule, classifyInvestment, needsReview, type ClassifyInput } from "../lib/classify";

const interest = (patch: Partial<ClassifyInput>): ClassifyInput => ({
  type: "INTEREST",
  amount: 100,
  ...patch,
});

describe("classifyByRule", () => {
  it("books JCP when a Brazilian stock has withholding, and a plain dividend when it does not", () => {
    const jcp = classifyByRule(interest({ ticker: "PETR4", assetSubtype: "STOCK", incomeTax: 15, description: "provento" }));
    expect(jcp).toMatchObject({ event: "income", incomeType: "jcp", taxWithheld: 15, gross: 100, source: "rule", confidence: 1 });
    const dividend = classifyByRule(interest({ ticker: "PETR4", assetSubtype: "STOCK", incomeTax: 0 }));
    expect(dividend).toMatchObject({ event: "income", incomeType: "dividend", origin: "br", taxWithheld: 0 });
    expect(classifyByRule(interest({ description: "Juros sobre capital próprio", ticker: "ZZTOP" }))).toMatchObject({ incomeType: "jcp" });
  });

  it("books FII income without tax and a BDR dividend from the ticker suffix", () => {
    expect(classifyByRule(interest({ ticker: "HGLG11", assetSubtype: "REAL_ESTATE_FUND", incomeTax: 5 }))).toMatchObject({
      incomeType: "fii_income",
      taxWithheld: 0,
      origin: null,
    });
    expect(classifyByRule(interest({ ticker: "AAPL34", incomeTax: 1 }))).toMatchObject({ incomeType: "dividend", origin: "bdr", taxWithheld: 1 });
  });

  it("treats amortization as a cost-basis event and never as income", () => {
    expect(classifyByRule({ type: "AMORTIZATION", amount: 200, ticker: "CDB" })).toMatchObject({ event: "amortization", gross: 200, source: "rule" });
  });

  it("does not treat buys, sales, transfers or tax as income", () => {
    expect(classifyByRule({ type: "BUY", amount: 1000 })).toMatchObject({ event: "buy" });
    expect(classifyByRule({ type: "SELL", amount: 40 })).toMatchObject({ event: "sell" });
    expect(classifyByRule({ type: "TRANSFER", amount: 50 })).toMatchObject({ event: "skip" });
    expect(classifyByRule({ type: "TAX", amount: 3 })).toMatchObject({ event: "skip" });
  });

  it("leaves an unmatched INTEREST row for the model", () => {
    expect(classifyByRule(interest({ ticker: "ZZTOP", assetType: "OTHER", assetSubtype: "OTHER", description: "Distribuição" }))).toBeNull();
  });
});

describe("classifyInvestment", () => {
  it("books the low-confidence guess and flags it for review", async () => {
    const result = await classifyInvestment(interest({ ticker: "ZZTOP", assetType: "OTHER", assetSubtype: "OTHER" }), async () => ({
      incomeType: "dividend",
      origin: "exterior",
      confidence: 0.4,
    }));
    expect(result).toMatchObject({ event: "income", incomeType: "dividend", origin: "exterior", confidence: 0.4, source: "llm" });
    expect(needsReview(result)).toBe(true);
  });

  it("books a zero-confidence interest guess when the model is absent", async () => {
    const result = await classifyInvestment(interest({ ticker: "ZZTOP", assetType: "OTHER" }), null);
    expect(result).toMatchObject({ incomeType: "interest", confidence: 0, source: "llm" });
    expect(needsReview(result)).toBe(true);
  });
});
