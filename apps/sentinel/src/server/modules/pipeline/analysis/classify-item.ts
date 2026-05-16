/**
 * Classifies a procurement item as PRODUCT (physical good with comparable refs),
 * SERVICE (labor/service whose price depends on scope), or GENERIC (description
 * too vague to compare on its own — requires context from the parent procurement).
 *
 * Used by analyze-overpricing.ts to dispatch the right evaluation strategy.
 */

export type ItemKind = "PRODUCT" | "SERVICE" | "GENERIC";

export type ClassifyInput = {
  description: string | null;
  materialOrService?: string | null;
  materialOrServiceName?: string | null;
  unit?: string | null;
  catmatCode?: string | null;
  catalogCode?: string | null;
};

const GENERIC_KEYWORDS = [
  "PRESTACAO DE SERVICO",
  "PRESTAÇÃO DE SERVIÇO",
  "PRESTACAO DE SERVICOS",
  "PRESTAÇÃO DE SERVIÇOS",
  "MATERIAL DIVERSO",
  "MATERIAIS DIVERSOS",
  "OUTROS SERVICOS",
  "OUTROS SERVIÇOS",
  "OUTROS MATERIAIS",
  "OUTROS",
  "DIVERSOS",
  "SERVICO",
  "SERVIÇO",
  "SERVICOS",
  "SERVIÇOS",
  "TAXA",
  "TAXAS",
  "DESPESAS DIVERSAS",
  "ITEM UNICO",
  "ITEM ÚNICO",
];

const SERVICE_UNITS = new Set([
  "HR",
  "H",
  "HORA",
  "HORAS",
  "DIA",
  "DIAS",
  "MES",
  "MÊS",
  "MESES",
  "SERV",
  "SERVICO",
  "SERVIÇO",
  "VB",
  "VERBA",
  "GLOBAL",
  "PROJETO",
]);

function normalize(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .trim();
}

function hasSpecificQualifier(desc: string): boolean {
  // A description is "specific" if it contains a number/measure/model marker.
  // Heuristic: contains 2+ digits (likely a model or measure), or has more
  // than 4 distinct uppercase tokens (more descriptive).
  if (/\d{2,}/.test(desc)) return true;
  const tokens = desc.split(/\s+/).filter((t) => t.length >= 2);
  return tokens.length >= 4;
}

function matchesGenericKeyword(normalized: string): boolean {
  const cleaned = normalized.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return GENERIC_KEYWORDS.some((kw) => {
    const kwNorm = normalize(kw).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    return cleaned === kwNorm || cleaned.startsWith(kwNorm + " ") || cleaned.endsWith(" " + kwNorm);
  });
}

/**
 * Returns kind based on cascading signals:
 *  1. materialOrService field from PNCP (most authoritative when present)
 *  2. unit hint (HR/DIA/MES/VB → service)
 *  3. CATMAT code → product (CATMAT covers materials)
 *  4. generic description heuristic → GENERIC
 *  5. fallback: PRODUCT
 */
export function classifyItem(input: ClassifyInput): ItemKind {
  const desc = (input.description ?? "").trim();
  const normalizedDesc = normalize(desc);

  // Generic check runs first to catch "PRESTAÇÃO DE SERVIÇO" even when
  // materialOrService says "S" — these are unclassifiable without context.
  if (matchesGenericKeyword(normalizedDesc)) return "GENERIC";
  if (normalizedDesc.length > 0 && normalizedDesc.length < 20 && !hasSpecificQualifier(desc)) {
    return "GENERIC";
  }

  // 1. PNCP materialOuServico is the most authoritative signal
  const mos = (input.materialOrService ?? "").trim().toUpperCase();
  const mosName = normalize(input.materialOrServiceName ?? "");
  if (mos === "S" || mosName.includes("SERVICO")) return "SERVICE";
  if (mos === "M" || mos === "B" || mosName.includes("MATERIAL") || mosName.includes("BEM")) {
    return "PRODUCT";
  }

  // 2. Unit hint
  const unit = normalize(input.unit ?? "");
  if (unit && SERVICE_UNITS.has(unit)) return "SERVICE";

  // 3. CATMAT presence → product (CATMAT is a materials catalog)
  if (input.catmatCode && input.catmatCode.trim().length > 0) return "PRODUCT";

  // 4. Fallback
  return "PRODUCT";
}
