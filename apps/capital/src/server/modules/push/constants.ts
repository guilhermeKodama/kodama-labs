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
