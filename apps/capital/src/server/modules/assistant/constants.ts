export const OPENAPI_TAGS = {
  v1: {
    name: "Assistant",
    description: "AI chat that reconciles uploaded statements into the ledger",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;

export const MAX_STATEMENT_FILE_BYTES = 15 * 1024 * 1024;

export const MAX_PDF_REQUEST_BUDGET_BYTES = 25 * 1024 * 1024;
export const MAX_PDFS_PER_TURN = 5;

export const MAX_TOOL_ITERATIONS_DEFAULT = 12;
export const MAX_TURN_COST_USD_DEFAULT = 0.5;

/** Anthropic's web_search server tool executes outside the client tool-call loop above, so it needs its own per-API-call cap. */
export const MAX_WEB_SEARCHES_PER_TURN = 5;

/** Plan confirmations older than this are treated as stale - the user must re-propose. */
export const PLAN_CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;
