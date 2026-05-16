export type CodeGroup =
  | "alertType"
  | "severity"
  | "shellCompanyFlag"
  | "priceAnalysisMethod"
  | "priceConfidence"
  | "itemKind"
  | "politicalLinkType"
  | "relationship"
  | "donorType"
  | "aiAnalysisType"
  | "aiTargetType";

export type CodeTranslator = (group: CodeGroup, code: string) => string;

export function createCodeFormatter(t: (key: string) => string): CodeTranslator {
  return (group, code) => {
    const key = `${group}.${code}`;
    const translated = t(key);
    return translated === key ? code : translated;
  };
}

export function formatCodeList(
  t: (key: string) => string,
  group: CodeGroup,
  codes: string[],
): string {
  const formatter = createCodeFormatter(t);
  return codes.map((c) => formatter(group, c)).join(", ");
}
