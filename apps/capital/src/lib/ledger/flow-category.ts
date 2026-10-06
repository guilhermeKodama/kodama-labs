/**
 * Category keys of uncategorized money moves: an aporte or resgate with no
 * category groups as "Investimentos" and a counted transfer with no
 * category as "Transferência", never as "Sem categoria". They are the
 * categoryId group keys of those rows and categoryId filter values
 * (`in`/`nin`) in display mode, where null then means "Sem categoria":
 * uncategorized income and expenses only. The `isNull` operator, and
 * legs mode (MCP, assistant), still match every empty category. Shared by
 * the query engine and Transações (labels, filter chips, drills).
 */
export const FLOW_CATEGORY_KEYS = { invest: "flow:invest", transfer: "flow:transfer" } as const;
export type FlowCategoryKey = (typeof FLOW_CATEGORY_KEYS)[keyof typeof FLOW_CATEGORY_KEYS];
export const isFlowCategoryKey = (value: unknown): value is FlowCategoryKey =>
  value === FLOW_CATEGORY_KEYS.invest || value === FLOW_CATEGORY_KEYS.transfer;
