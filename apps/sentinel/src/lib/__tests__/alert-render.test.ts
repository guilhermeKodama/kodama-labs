import { describe, it, expect } from "vitest";
import {
  extractAlertI18n,
  mergeLocaleParams,
  renderAlertText,
  type AlertI18n,
} from "../alert-render";

const baseI18n: AlertI18n = {
  titleKey: "alerts.templates.demo.title",
  descriptionKey: "alerts.templates.demo.description",
  params: { itemDescription: "Serviço de manutenção", unitPrice: "R$ 1000,00" },
};

describe("alert-render: paramsByLocale support", () => {
  it("mergeLocaleParams returns params unchanged when no overrides", () => {
    expect(mergeLocaleParams(baseI18n, "en")).toEqual({
      itemDescription: "Serviço de manutenção",
      unitPrice: "R$ 1000,00",
    });
  });

  it("mergeLocaleParams overrides per-locale values", () => {
    const i18n: AlertI18n = {
      ...baseI18n,
      paramsByLocale: {
        en: { itemDescription: "Maintenance service" },
      },
    };
    expect(mergeLocaleParams(i18n, "en")).toEqual({
      itemDescription: "Maintenance service",
      unitPrice: "R$ 1000,00",
    });
    // pt-BR (no overrides for that locale) falls back to params
    expect(mergeLocaleParams(i18n, "pt-BR")).toEqual({
      itemDescription: "Serviço de manutenção",
      unitPrice: "R$ 1000,00",
    });
  });

  it("renderAlertText injects locale-specific override into template", () => {
    const i18n: AlertI18n = {
      ...baseI18n,
      paramsByLocale: { en: { itemDescription: "Maintenance service" } },
    };
    const tTemplates = (_key: string, p: Record<string, string | number>) =>
      `Item: ${p.itemDescription}, price ${p.unitPrice}`;
    const tCodes = (k: string) => k;

    expect(renderAlertText("fallback", i18n, "titleKey", tTemplates, tCodes, "en"))
      .toBe("Item: Maintenance service, price R$ 1000,00");
    expect(renderAlertText("fallback", i18n, "titleKey", tTemplates, tCodes, "pt-BR"))
      .toBe("Item: Serviço de manutenção, price R$ 1000,00");
  });

  it("extractAlertI18n preserves paramsByLocale when present", () => {
    const data = {
      i18n: {
        titleKey: "k",
        descriptionKey: "d",
        params: { a: "x" },
        paramsByLocale: { en: { a: "y" } },
      },
    };
    const extracted = extractAlertI18n(data);
    expect(extracted?.paramsByLocale).toEqual({ en: { a: "y" } });
  });

  it("extractAlertI18n omits paramsByLocale when missing (backward compat)", () => {
    const data = { i18n: { titleKey: "k", descriptionKey: "d", params: { a: "x" } } };
    const extracted = extractAlertI18n(data);
    expect(extracted).toBeTruthy();
    expect(extracted?.paramsByLocale).toBeUndefined();
  });

  it("renderAlertText still works without paramsByLocale (backward compat)", () => {
    const tTemplates = (_key: string, p: Record<string, string | number>) =>
      `desc: ${p.itemDescription}`;
    const tCodes = (k: string) => k;
    expect(renderAlertText("fb", baseI18n, "titleKey", tTemplates, tCodes, "en"))
      .toBe("desc: Serviço de manutenção");
  });

  it("returns fallback when i18n is null", () => {
    const tTemplates = () => "should not be called";
    const tCodes = (k: string) => k;
    expect(renderAlertText("the fallback", null, "titleKey", tTemplates, tCodes, "en")).toBe(
      "the fallback",
    );
  });
});
