import { formatCodeList, type CodeGroup } from "./codes";

export type AlertI18n = {
  titleKey: string;
  descriptionKey: string;
  params: Record<string, string | number>;
};

const CODE_PARAM_GROUPS: Record<string, CodeGroup> = {
  flags: "shellCompanyFlag",
  confidence: "priceConfidence",
  method: "priceAnalysisMethod",
  relationshipLabel: "relationship",
};

export function extractAlertI18n(data: unknown): AlertI18n | null {
  if (!data || typeof data !== "object") return null;
  const i18n = (data as Record<string, unknown>).i18n;
  if (!i18n || typeof i18n !== "object") return null;
  const obj = i18n as Record<string, unknown>;
  if (typeof obj.titleKey !== "string" || typeof obj.descriptionKey !== "string") return null;
  return {
    titleKey: obj.titleKey,
    descriptionKey: obj.descriptionKey,
    params: (obj.params as Record<string, string | number>) ?? {},
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

export function renderAlertText(
  fallback: string,
  i18n: AlertI18n | null,
  key: "titleKey" | "descriptionKey",
  tTemplates: (key: string, params: Record<string, string | number>) => string,
  tCodes: (key: string) => string,
): string {
  if (!i18n) return fallback;
  try {
    const params = translateAlertParams(i18n.params, tCodes);
    return tTemplates(i18n[key], params);
  } catch {
    return fallback;
  }
}
