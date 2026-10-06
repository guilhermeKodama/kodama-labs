import { describe, expect, it } from "vitest";
import { SYSTEM_CATEGORY_DEFINITIONS } from "@capital/server/modules/categories/lib/system-categories";
import { categories } from "../categories";
import { common } from "../common";
import type { MessageTree } from "../define";
import { DEFAULT_LOCALE, LOCALES, matchLocale, negotiateLocale, resolveLocale, st } from "../index";
import { ledger } from "../ledger";
import { views } from "../views";

function leaves(tree: MessageTree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [[`${prefix}${key}`, value]] : Object.entries(leaves(value, `${prefix}${key}.`))))
  );
}

const placeholders = (s: string) => Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();

describe("server i18n", () => {
  it("translates by locale, filling params, and falls back to pt-BR", () => {
    expect(st("pt-BR", "common.copySuffix")).toBe("(cópia)");
    expect(st("en", "common.copySuffix")).toBe("(copy)");
    expect(st("fr", "common.copySuffix")).toBe("(cópia)");
    expect(st(null, "views.ledger.ir")).toBe("Dedutíveis IR");
    expect(st("en", "ledger.transferDescription", { direction: st("en", "ledger.direction.capital_injection"), from: "PF", to: "Kodama LTDA" })).toBe(
      "Capital injection: PF → Kodama LTDA"
    );
    expect(st("pt-BR", "ledger.transferDescription", { direction: "X" })).toBe("X: {from} → {to}");
  });

  it("resolves locale tags to a supported locale", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("pt")).toBe("pt-BR");
    expect(resolveLocale("pt_br")).toBe("pt-BR");
    expect(resolveLocale("de-DE")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(matchLocale(" EN-gb ")).toBe("en");
    expect(matchLocale("de-DE")).toBeUndefined();
    expect(matchLocale("")).toBeUndefined();
  });

  it("negotiates Accept-Language by weight, then order, skipping unsupported languages", () => {
    expect(negotiateLocale("en-US,en;q=0.9,pt-BR;q=0.8")).toBe("en");
    expect(negotiateLocale("fr-CA, en;q=0.8, pt;q=0.5")).toBe("en");
    expect(negotiateLocale("en;q=0.4, pt-BR;q=0.9")).toBe("pt-BR");
    expect(negotiateLocale("pt, en")).toBe("pt-BR");
    expect(negotiateLocale("en;q=0, pt;q=0.1")).toBe("pt-BR");
    expect(negotiateLocale("de-DE, *;q=0.5")).toBeUndefined();
    expect(negotiateLocale("")).toBeUndefined();
    expect(negotiateLocale(null)).toBeUndefined();
  });

  it("has the same keys and placeholders in every locale", () => {
    for (const dictionary of [common, ledger, views, categories]) {
      const source = leaves(dictionary["pt-BR"]);
      for (const locale of LOCALES) {
        const translated = leaves(dictionary[locale]);
        expect(Object.keys(translated).sort()).toEqual(Object.keys(source).sort());
        for (const [key, text] of Object.entries(source)) expect(placeholders(translated[key])).toEqual(placeholders(text));
      }
    }
  });

  it("names every system category, in English exactly as the catalog does, with unique pt-BR names per type", () => {
    const keys = SYSTEM_CATEGORY_DEFINITIONS.map((d) => d.systemKey).sort();
    expect(Object.keys(categories["pt-BR"].system).sort()).toEqual(keys);
    for (const def of SYSTEM_CATEGORY_DEFINITIONS) {
      expect(st("en", `categories.system.${def.systemKey as keyof typeof categories.en.system}`)).toBe(def.name);
    }
    for (const type of ["income", "expense", "investment"]) {
      const names = SYSTEM_CATEGORY_DEFINITIONS.filter((d) => d.type === type).map((d) => categories["pt-BR"].system[d.systemKey as keyof typeof categories.en.system]);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
