import { formatCodeList, type CodeGroup } from "./codes";

export type AlertI18n = {
  titleKey: string;
  descriptionKey: string;
  params: Record<string, string | number>;
  /**
   * Optional per-locale overrides. Keys are locale codes (e.g. "en", "pt-BR").
   * When rendering for a given locale, values here are merged on top of
   * `params`. Allows alerts to carry locale-specific free-text values
   * (e.g. an item description translated into English).
   */
  paramsByLocale?: Record<string, Record<string, string | number>>;
};

const CODE_PARAM_GROUPS: Record<string, CodeGroup> = {
  flags: "shellCompanyFlag",
  confidence: "priceConfidence",
  method: "priceAnalysisMethod",
  kind: "itemKind",
  relationshipLabel: "relationship",
};

export function extractAlertI18n(data: unknown): AlertI18n | null {
  if (!data || typeof data !== "object") return null;
  const i18n = (data as Record<string, unknown>).i18n;
  if (!i18n || typeof i18n !== "object") return null;
  const obj = i18n as Record<string, unknown>;
  if (typeof obj.titleKey !== "string" || typeof obj.descriptionKey !== "string") return null;
  const paramsByLocale =
    obj.paramsByLocale && typeof obj.paramsByLocale === "object"
      ? (obj.paramsByLocale as Record<string, Record<string, string | number>>)
      : undefined;
  return {
    titleKey: obj.titleKey,
    descriptionKey: obj.descriptionKey,
    params: (obj.params as Record<string, string | number>) ?? {},
    ...(paramsByLocale ? { paramsByLocale } : {}),
  };
}

export function translateAlertParams(
  params: Record<string, string | number>,
  tCodes: (key: string) => string,
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params };
  for (const [key, group] of Object.entries(CODE_PARAM_GROUPS)) {
    const raw = out[key];
    if (typeof raw !== "string" || raw === "") continue;
    if (key === "flags") {
      const codes = raw.split(",").map((c) => c.trim()).filter(Boolean);
      out[key] = formatCodeList(tCodes, group, codes);
    } else {
      const translated = tCodes(`${group}.${raw}`);
      out[key] = translated === `${group}.${raw}` ? raw : translated;
    }
  }
  return out;
}

/**
 * Merges the locale-specific overrides on top of the default params.
 * Exported for testing.
 */
export function mergeLocaleParams(
  i18n: AlertI18n,
  locale: string,
): Record<string, string | number> {
  const overrides = i18n.paramsByLocale?.[locale];
  return overrides ? { ...i18n.params, ...overrides } : i18n.params;
}

export function renderAlertText(
  fallback: string,
  i18n: AlertI18n | null,
  key: "titleKey" | "descriptionKey",
  tTemplates: (key: string, params: Record<string, string | number>) => string,
  tCodes: (key: string) => string,
  locale: string,
): string {
  if (!i18n) return fallback;
  try {
    const merged = mergeLocaleParams(i18n, locale);
    const params = translateAlertParams(merged, tCodes);
    return tTemplates(i18n[key], params);
  } catch {
    return fallback;
  }
}
