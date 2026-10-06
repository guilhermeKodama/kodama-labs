export const OPENAPI_TAGS = {
  v1: {
    name: "Push",
    description: "Web Push subscription management endpoints",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;

/**
 * Where a recurring-bill reminder opens: Orçamentos, which holds Contas
 * fixas since /recurring was retired (next.config.ts redirects it here).
 * Also the service worker's fallback for a push without a url.
 */
export const REMINDER_PUSH_URL = "/transactions/budgets";
