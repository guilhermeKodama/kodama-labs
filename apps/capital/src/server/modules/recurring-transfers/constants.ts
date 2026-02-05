export const OPENAPI_TAGS = {
  v1: {
    name: "RecurringTransfers",
    description: "Recurring transfer management endpoints",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;
