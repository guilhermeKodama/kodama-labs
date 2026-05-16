import ptBR from "@/messages/pt-BR.json";

export type AlertI18nParam = string | number | null | undefined;

export type AlertI18n = {
  titleKey: string;
  descriptionKey: string;
  params: Record<string, AlertI18nParam>;
};

export function buildAlertI18n(
  titleKey: string,
  descriptionKey: string,
  params: Record<string, AlertI18nParam>,
): AlertI18n {
  return { titleKey, descriptionKey, params };
}

function getByPath(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(template: string, params: Record<string, AlertI18nParam>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

export function renderPtBr(key: string, params: Record<string, AlertI18nParam> = {}): string {
  const template = getByPath(ptBR, key);
  if (!template) return key;
  return interpolate(template, params);
}

export function renderCodePtBr(group: string, code: string): string {
  return renderPtBr(`codes.${group}.${code}`) || code;
}

export function renderCodeListPtBr(group: string, codes: string[]): string {
  return codes.map((c) => renderCodePtBr(group, c)).join(", ");
}
