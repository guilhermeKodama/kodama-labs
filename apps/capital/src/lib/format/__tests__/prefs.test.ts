import { describe, expect, it } from "vitest";
import { createFormatter } from "@/lib/format/formatter";
import {
  DEFAULT_FORMAT_PREFS,
  normalizeCurrency,
  normalizeDateFormat,
  normalizeLocale,
  normalizeNumberFormat,
  normalizeTimezone,
  resolveFormatPrefs,
} from "@/lib/format/prefs";

describe("normalizeNumberFormat", () => {
  it("accepts the new values and the legacy stored ones", () => {
    expect(normalizeNumberFormat("pt-BR")).toBe("pt-BR");
    expect(normalizeNumberFormat("en-US")).toBe("en-US");
    expect(normalizeNumberFormat("1.234,56")).toBe("pt-BR");
    expect(normalizeNumberFormat("1,234.56")).toBe("en-US");
    expect(normalizeNumberFormat("de-DE")).toBe("pt-BR");
    expect(normalizeNumberFormat(" EN-us ")).toBe("en-US");
  });

  it("falls back to the default", () => {
    expect(normalizeNumberFormat("fr-FR")).toBe("pt-BR");
    expect(normalizeNumberFormat(undefined)).toBe("pt-BR");
    expect(normalizeNumberFormat(42, "en-US")).toBe("en-US");
  });
});

describe("normalizeDateFormat", () => {
  it("accepts the three formats in any case", () => {
    expect(normalizeDateFormat("dd/MM/yyyy")).toBe("dd/MM/yyyy");
    expect(normalizeDateFormat("yyyy-MM-dd")).toBe("yyyy-MM-dd");
    expect(normalizeDateFormat("MM/DD/YYYY")).toBe("MM/dd/yyyy");
    expect(normalizeDateFormat("DD/MM/YYYY")).toBe("dd/MM/yyyy");
  });

  it("falls back to the default", () => {
    expect(normalizeDateFormat("d.M.yy")).toBe("dd/MM/yyyy");
    expect(normalizeDateFormat(null)).toBe("dd/MM/yyyy");
  });
});

describe("normalizeLocale", () => {
  it("maps language tags to the app's two locales", () => {
    expect(normalizeLocale("pt-BR")).toBe("pt-BR");
    expect(normalizeLocale("pt")).toBe("pt-BR");
    expect(normalizeLocale("pt_PT")).toBe("pt-BR");
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("es")).toBe("pt-BR");
  });
});

describe("normalizeTimezone and normalizeCurrency", () => {
  it("keeps valid IANA zones and ISO codes", () => {
    expect(normalizeTimezone("America/New_York")).toBe("America/New_York");
    expect(normalizeTimezone("Mars/Olympus")).toBe("America/Sao_Paulo");
    expect(normalizeTimezone("")).toBe("America/Sao_Paulo");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("R$")).toBe("BRL");
  });
});

describe("resolveFormatPrefs", () => {
  it("fills what is missing with the signup defaults", () => {
    expect(resolveFormatPrefs(null)).toEqual(DEFAULT_FORMAT_PREFS);
    expect(resolveFormatPrefs({ numberFormat: "1,234.56", dateFormat: "yyyy-MM-dd", locale: "en", baseCurrency: "usd" })).toEqual({
      numberFormat: "en-US",
      dateFormat: "yyyy-MM-dd",
      timezone: "America/Sao_Paulo",
      locale: "en",
      baseCurrency: "USD",
    });
  });

  it("is applied by createFormatter to raw session values", () => {
    const fmt = createFormatter({ numberFormat: "1,234.56", dateFormat: "nonsense", timezone: undefined, locale: "en-GB", baseCurrency: "BRL" });
    expect(fmt.prefs).toEqual({ numberFormat: "en-US", dateFormat: "dd/MM/yyyy", timezone: "America/Sao_Paulo", locale: "en", baseCurrency: "BRL" });
    expect(fmt.money(1234.5)).toBe("R$ 1,234.50");
  });
});
