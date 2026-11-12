import { describe, expect, it } from "vitest";
import { classifyByRule, classifyInvestment, needsReview, type IncomeGuesser } from "../lib/classify";
import { consentState, dayOf, importSince, onOrAfter, sinceDate } from "../lib/consent";
import { accountLabel, last4Digits, maskAccountNumber, redactForModel } from "../lib/mask";

describe("classifyByRule edge cases", () => {
  it("treats a fund whose ticker ends in 11 as a FII, but a BDR ending in 32-35 as a BDR first", () => {
    expect(classifyByRule({ type: "INTEREST", amount: 30, ticker: "XPLG11" })).toMatchObject({ event: "income", incomeType: "fii_income", taxWithheld: 0, source: "rule" });
    expect(classifyByRule({ type: "interest", amount: 5, ticker: "aapl34", incomeTax: 1 })).toMatchObject({ incomeType: "dividend", origin: "BDR", taxWithheld: 1 });
  });

  it("does not take a BDR ticker for a Brazilian stock", () => {
    // Ends in a digit pattern the stock regex would accept if BDR were not ruled out first.
    expect(classifyByRule({ type: "INTEREST", amount: 5, ticker: "ABCD34", assetSubtype: "STOCK" })).toMatchObject({ origin: "BDR" });
  });

  it("calls a stock with tax withheld JCP and without it a plain Brazilian dividend", () => {
    expect(classifyByRule({ type: "INTEREST", amount: 100, ticker: "PETR4", incomeTax: 15 })).toMatchObject({ incomeType: "jcp", taxWithheld: 15, origin: null });
    expect(classifyByRule({ type: "INTEREST", amount: 100, ticker: "PETR4" })).toMatchObject({ incomeType: "dividend", origin: "BR", taxWithheld: 0 });
    expect(classifyByRule({ type: "INTEREST", amount: 100, ticker: "XYZ", assetSubtype: "STOCK", description: "juros sobre capital próprio" })).toMatchObject({ incomeType: "jcp" });
  });

  it("recognises fixed income by asset type or by subtype, case-insensitively, and ignores negative tax", () => {
    expect(classifyByRule({ type: "INTEREST", amount: 8, assetType: "fixed_income", incomeTax: -3 })).toMatchObject({ incomeType: "fixed_income_interest", taxWithheld: 0 });
    for (const assetSubtype of ["cdb", "RDB", "LCI", "LCA", "CRI", "CRA", "TREASURY", "DEBENTURES"]) {
      expect(classifyByRule({ type: "INTEREST", amount: 8, assetSubtype })).toMatchObject({ incomeType: "fixed_income_interest" });
    }
  });

  it("leaves an INTEREST row nothing identifies to the model", () => {
    expect(classifyByRule({ type: "INTEREST", amount: 8, ticker: "ZZTOP", assetType: "OTHER", assetSubtype: "OTHER" })).toBeNull();
    expect(classifyByRule({ type: "INTEREST", amount: 8 })).toBeNull();
  });

  it("skips every type that is not interest, a trade or an amortization", () => {
    for (const type of ["TAX", "TRANSFER", "DEPOSIT", "WHATEVER", "tax"]) {
      expect(classifyByRule({ type, amount: -12 })).toEqual({ event: "skip", gross: 12, confidence: 1, source: "rule" });
    }
    expect(classifyByRule({ type: "buy", amount: -50 })).toMatchObject({ event: "buy", gross: 50 });
    expect(classifyByRule({ type: "Sell", amount: 50 })).toMatchObject({ event: "sell", gross: 50 });
    expect(classifyByRule({ type: "AMORTIZATION", amount: -9 })).toMatchObject({ event: "amortization", gross: 9 });
  });
});

describe("classifyInvestment with the model", () => {
  const unknown = { type: "INTEREST", amount: -40, incomeTax: 4 };

  it("takes a guess's type and origin, clamping its confidence into 0..1", async () => {
    const high: IncomeGuesser = async () => ({ incomeType: "dividend", origin: "EXTERIOR", confidence: 7 });
    expect(await classifyInvestment(unknown, high)).toEqual({ event: "income", incomeType: "dividend", origin: "EXTERIOR", gross: 40, taxWithheld: 4, confidence: 1, source: "llm" });
    const negative: IncomeGuesser = async () => ({ incomeType: "jcp", origin: "BR", confidence: -2 });
    // Origin only matters for dividends.
    expect(await classifyInvestment(unknown, negative)).toMatchObject({ incomeType: "jcp", origin: null, confidence: 0 });
  });

  it("falls back to fixed-income interest with no confidence when there is no guess, the guesser returns null or it throws", async () => {
    const expected = { event: "income", incomeType: "fixed_income_interest", origin: null, gross: 40, taxWithheld: 4, confidence: 0, source: "llm" };
    expect(await classifyInvestment(unknown, null)).toEqual(expected);
    expect(await classifyInvestment(unknown, async () => null)).toEqual(expected);
    expect(
      await classifyInvestment(unknown, async () => {
        throw new Error("down");
      }),
    ).toEqual(expected);
  });

  it("does not call the model when a rule decides", async () => {
    let called = false;
    const guesser: IncomeGuesser = async () => {
      called = true;
      return null;
    };
    expect(await classifyInvestment({ type: "BUY", amount: 5 }, guesser)).toMatchObject({ event: "buy" });
    expect(called).toBe(false);
  });

  it("asks for review below 0.8 confidence and only for income", () => {
    expect(needsReview({ event: "income", incomeType: "jcp", origin: null, gross: 1, taxWithheld: 0, confidence: 0.79, source: "llm" })).toBe(true);
    expect(needsReview({ event: "income", incomeType: "jcp", origin: null, gross: 1, taxWithheld: 0, confidence: 0.8, source: "llm" })).toBe(false);
    expect(needsReview({ event: "buy", gross: 1, confidence: 0, source: "rule" })).toBe(false);
  });
});

describe("consent edge cases", () => {
  const NOW = new Date("2026-10-19T15:00:00.000Z");

  it("expires on USER_AUTHORIZATION_EXPIRED whatever the item status is", () => {
    expect(consentState({ id: "1", status: "UPDATED", error: { code: "USER_AUTHORIZATION_EXPIRED" } }, NOW)).toBe("expired");
    expect(consentState({ id: "1", status: "UPDATED", consentExpiresAt: "2030-01-01T00:00:00.000Z", error: { code: "USER_AUTHORIZATION_EXPIRED" } }, NOW)).toBe("expired");
  });

  it("is ok with no consent date unless the login failed, and with a date it cannot read", () => {
    expect(consentState({ id: "1", status: "UPDATED" }, NOW)).toBe("ok");
    expect(consentState({ id: "1", status: "UPDATED", consentExpiresAt: null, error: { code: "OTHER" } }, NOW)).toBe("ok");
    expect(consentState({ id: "1", status: "LOGIN_ERROR", consentExpiresAt: null }, NOW)).toBe("expired");
    expect(consentState({ id: "1", consentExpiresAt: "not a date" }, NOW)).toBe("ok");
  });

  it("is expired exactly at the consent date and expiring on the 30th day", () => {
    expect(consentState({ id: "1", consentExpiresAt: NOW.toISOString() }, NOW)).toBe("expired");
    expect(consentState({ id: "1", consentExpiresAt: "2026-11-18T15:00:00.000Z" }, NOW)).toBe("expiring");
    expect(consentState({ id: "1", consentExpiresAt: "2026-11-18T15:00:01.000Z" }, NOW)).toBe("ok");
  });

  it("imports from the later of the overlap window and the cutoff", () => {
    const lastSuccess = new Date("2026-10-15T10:00:00.000Z");
    expect(sinceDate(lastSuccess, NOW)).toBe("2026-10-08");
    expect(importSince(lastSuccess, null, NOW)).toBe("2026-10-08");
    expect(importSince(lastSuccess, new Date("2026-10-12T12:00:00.000Z"), NOW)).toBe("2026-10-12");
    expect(importSince(lastSuccess, new Date("2026-09-01T12:00:00.000Z"), NOW)).toBe("2026-10-08");
    expect(importSince(null, new Date("2026-09-01T12:00:00.000Z"), NOW)).toBe("2026-09-01");
    expect(importSince(null, new Date("2020-01-01T12:00:00.000Z"), NOW)).toBe("2025-10-19");
  });

  it("compares by calendar day", () => {
    expect(dayOf("2026-10-19T23:59:59.000Z")).toBe("2026-10-19");
    expect(onOrAfter("2026-10-19T00:00:00.000Z", "2026-10-19")).toBe(true);
    expect(onOrAfter("2026-10-18T23:59:59.000Z", "2026-10-19")).toBe(false);
  });
});

describe("mask edge cases", () => {
  it("keeps four digits or nothing", () => {
    expect(last4Digits("12-345")).toBe("2345");
    expect(last4Digits("123")).toBeNull();
    expect(last4Digits("abc")).toBeNull();
    expect(last4Digits(null)).toBeNull();
    expect(last4Digits(undefined)).toBeNull();
    expect(maskAccountNumber("12")).toBe("••••12");
    expect(maskAccountNumber("")).toBe("");
    expect(maskAccountNumber(null)).toBe("");
    expect(maskAccountNumber("no digits")).toBe("");
  });

  it("labels an account with its trimmed name or a default, masked number only when there are digits", () => {
    expect(accountLabel("  Poupança  ", "99887766")).toBe("Poupança ••••7766");
    expect(accountLabel(null, "99887766")).toBe("Conta ••••7766");
    expect(accountLabel("   ", undefined)).toBe("Conta");
    expect(accountLabel("Cartão", "")).toBe("Cartão");
  });

  it("redacts long digit runs and formatted documents but leaves short numbers", () => {
    expect(redactForModel("PIX 1234 ref 12345")).toBe("PIX 1234 ref ••••");
    expect(redactForModel("cnpj 12.345.678/0001-90 e cpf 123.456.789-00")).toBe("cnpj •••• e cpf ••••");
  });
});
